import { useEffect, useState, useRef } from 'react';
import * as ExifReader from 'exifreader';

// Robust error handling for iframe environment
if (typeof window !== 'undefined') {
  const logError = (type: string, error: any) => {
    console.error(`[${type}]`, error);
    // In some environments, "Script error." happens when an error is caught but lacks details
    // We try to log as much as possible to the console which is visible in the agent logs
  };

  window.addEventListener('error', (e) => {
    if (e.message === 'ResizeObserver loop completed with undelivered notifications.' || 
        e.message === 'ResizeObserver loop limit exceeded') {
      e.stopImmediatePropagation();
      return;
    }
    logError('Uncaught Error', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    logError('Unhandled Rejection', e.reason);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

async function extractImageMetadata(file: File): Promise<string | null> {
  try {
    const tags = await ExifReader.load(file);
    // Automatic1111 PNG
    if (tags['parameters'] && tags['parameters'].description) {
      return tags['parameters'].description;
    }
    // WebP / JPEG (Exif UserComment)
    const userComment = tags['UserComment'] as any;
    if (userComment && userComment.value) {
      const val = userComment.value;
      if (Array.isArray(val)) {
        // Sometimes it's an array of char codes
        const text = new TextDecoder().decode(new Uint8Array(val));
        // Strip UNICODE prefix if present
        return text.replace(/^UNICODE\0/, '').replace(/^ASCII\0\0\0/, '').trim();
      } else if (typeof val === 'string') {
        return val;
      }
    }
    // ComfyUI or other JSON workflows might be in 'workflow' or 'prompt' but A1111 uses parameters
  } catch (err) {
    console.error('Erro ao extrair metadados da imagem:', err);
  }
  return null;
}

function parseSDParameters(params: string) {
  const lines = params.split('\n');
  let prompt = '';
  let negative = '';
  let otherParams = '';
  
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('Negative prompt:') && !lines[i].includes('Steps:')) {
    prompt += (prompt ? '\n' : '') + lines[i];
    i++;
  }
  
  if (i < lines.length && lines[i].startsWith('Negative prompt:')) {
    negative = lines[i].replace('Negative prompt:', '').trim();
    i++;
    while (i < lines.length && !lines[i].includes('Steps:')) {
      negative += (negative ? '\n' : '') + lines[i];
      i++;
    }
  }
  
  if (i < lines.length) {
    otherParams = lines.slice(i).join('\n');
  }

  const extractField = (str: string, field: string) => {
    const regex = new RegExp(`${field}:\\s*([^,]+)`);
    const match = str.match(regex);
    return match ? match[1].trim() : '';
  };

  const steps = extractField(otherParams, 'Steps');
  const sampler = extractField(otherParams, 'Sampler');
  const cfgScale = extractField(otherParams, 'CFG scale');
  const seed = extractField(otherParams, 'Seed');
  const baseModel = extractField(otherParams, 'Model');
  
  let loras = '';
  const loraMatches = prompt.match(/<lora:[^>]+>/g);
  if (loraMatches) {
    loras = loraMatches.join(', ');
  }

  return { prompt, negative, steps, sampler, cfgScale, seed, baseModel, loras, otherParams };
}

const translations: Record<string, string> = {
  // Negative
  'worst quality': 'pior qualidade',
  'low quality': 'baixa qualidade',
  'bad anatomy': 'anatomia ruim',
  'bad proportions': 'proporções ruins',
  'deformed': 'deformado',
  'disfigured': 'desfigurado',
  'mutated hands': 'mãos mutantes',
  'extra fingers': 'dedos extras',
  'missing limbs': 'membros ausentes',
  'blurry': 'embaçado',
  'lowres': 'baixa resolução',
  'ugly': 'feio',
  // Score
  'score_9': 'pontuação 9',
  'score_8_up': 'pontuação 8+',
  'score_7_up': 'pontuação 7+',
  'masterpiece': 'obra-prima',
  'best quality': 'melhor qualidade',
  'highly detailed': 'altamente detalhado',
  'ultra detailed': 'ultra detalhado',
  '4k': '4k',
  '8k': '8k',
  'hyperrealistic': 'hiper-realista',
  'photorealistic': 'fotorrealista',
  'extremely detailed': 'extremamente detalhado',
  // Lighting
  'cinematic lighting': 'iluminação cinematográfica',
  'dramatic lighting': 'iluminação dramática',
  'volumetric lighting': 'iluminação volumétrica',
  'god rays': 'raios de sol',
  'rim lighting': 'iluminação de contorno',
  'soft lighting': 'iluminação suave',
  // Artstyle
  'anime': 'anime',
  'realistic': 'realista',
  'cyberpunk': 'cyberpunk',
  'fantasy': 'fantasia',
  'digital art': 'arte digital',
  '3d render': 'renderização 3d',
  // Composition
  'close-up': 'primeiro plano',
  'portrait': 'retrato',
  'full body': 'corpo inteiro',
  'wide shot': 'plano aberto',
  'medium shot': 'plano médio',
  // Characters
  '1girl': '1 garota',
  '1boy': '1 garoto',
  '2girls': '2 garotas',
  'multiple girls': 'várias garotas',
  'solo': 'sozinho(a)',
  'group': 'grupo',
  // Expressions
  'smiling': 'sorrindo',
  'crying': 'chorando',
  'angry': 'bravo(a)',
  'surprised': 'surpreso(a)',
  'blushing': 'corado(a)',
  'sad': 'triste',
  // Poses
  'standing': 'em pé',
  'sitting': 'sentado(a)',
  'kneeling': 'ajoelhado(a)',
  'dynamic pose': 'pose dinâmica',
  'lying down': 'deitado(a)',
  // Clothes
  'school_uniform': 'uniforme escolar',
  'maid': 'empregada',
  'bikini': 'biquíni',
  'dress': 'vestido',
  'skirt': 'saia',
  // Environment
  'outdoors': 'ao ar livre',
  'forest': 'floresta',
  'city': 'cidade',
  'simple background': 'fundo simples',
  'white background': 'fundo branco',
  // Atmosphere
  'foggy': 'nevoeiro',
  'rainy': 'chuvoso',
  'snowy': 'nevado',
  // Effects
  'motion blur': 'desfoque de movimento',
  'chromatic aberration': 'aberração cromática',
  'vignette': 'vinheta',
  // Kitty
  'cat_ears': 'orelhas de gato',
  'neko': 'neko',
  'kitty': 'gatinho',
  'cat_tail': 'cauda de gato',
  // NSFW
  'masturbation': 'masturbação',
  'solo focus': 'foco solo',
  'vibrator': 'vibrador',
  'fingering': 'dedilhando'
};

let translationCache: Record<string, string> = {};
try {
  translationCache = JSON.parse(localStorage.getItem('tagmaster_translations') || '{}');
} catch (e) {
  console.error('Erro ao carregar cache de tradução:', e);
}

async function fetchGoogleTranslation(text: string): Promise<string> {
  if (!text) return '';
  
  // Ignore layer tags
  if (text.startsWith('[') && text.endsWith(']')) return '';
  
  // Limpa a tag para tradução (remove pesos e loras)
  let clean = text.replace(/^\(+|\)+$/g, '').split(':')[0].trim();
  if (clean.startsWith('<lora:')) {
    const match = clean.match(/<lora:([^:]+):/);
    clean = match ? match[1] : clean;
  }
  clean = clean.toLowerCase().replace(/_/g, ' ');

  // Verifica cache
  if (translationCache[clean]) return translationCache[clean];
  if (translations[clean]) return translations[clean]; // Usa o dicionário local como fallback rápido

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(clean)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translated = data[0][0][0];
    
    // Salva no cache
    translationCache[clean] = translated;
    try {
      localStorage.setItem('tagmaster_translations', JSON.stringify(translationCache));
    } catch (e) {
      console.error('Erro ao salvar cache de tradução:', e);
    }
    
    return translated;
  } catch (error) {
    console.error('Erro na tradução:', error);
    return '';
  }
}

function updateTranslationElement(el: HTMLElement, text: string) {
  fetchGoogleTranslation(text).then(translated => {
    if (el) el.textContent = translated;
  }).catch(err => console.error('Erro no updateTranslationElement:', err));
}

const PREDEFINED_GROUPS = [
  'Qualidade', 
  'Ângulos de Câmera', 
  'Câmera e Enquadramento', 
  'Ação entre Personagens', 
  'Personagem', 
  'Background e Cenário'
];

export default function App() {
  const [selectedIcon, setSelectedIcon] = useState('🏷️');
  const [selectedColor, setSelectedColor] = useState('#808080');
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [currentPromptTitle, setCurrentPromptTitle] = useState('');
  const [currentPromptThumbnail, setCurrentPromptThumbnail] = useState<string | null>(null);
  const [currentAdvanced, setCurrentAdvanced] = useState<{
    baseModel: string;
    loras: string;
    cfgScale: string;
    steps: string;
    sampler: string;
    seed: string;
    otherParams: string;
  }>({ baseModel: '', loras: '', cfgScale: '', steps: '', sampler: '', seed: '', otherParams: '' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedPresets, setExpandedPresets] = useState<Set<number>>(new Set());
  const icons = ['🏷️', '👤', '🆔', '💇', '👁️', '😊', '🏃', '👔', '👕', '👙', '👖', '🎒', '👟', '🌍', '🌿', '🏙️', ' পিক', '📦', '🐾', '📸', '🏮', '🔌', '⭐', '🚫', '🎨', '🎭', '🎬', '🎤', '🎮', '🎲', '🎯', '🔮', '🧬', '🔭', '🛸', '⚔️', '🛡️', '💎', '💰', '🕯️', '🗝️'];

  const importTitleRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLTextAreaElement>(null);

  const [presets, setPresets] = useState<{ 
    id: number; 
    name: string; 
    prompt: string; 
    negativePrompt?: string;
    notes: string; 
    image?: string;
    baseModel?: string;
    loras?: string;
    cfgScale?: string;
    steps?: string;
    sampler?: string;
    seed?: string;
    otherParams?: string;
  }[]>([]);

  const safeSetItem = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(`Erro ao salvar no localStorage (${key}):`, e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        // Strategy: Clear translation cache if quota is exceeded
        localStorage.removeItem('tagmaster_translations');
        // Try again
        try { localStorage.setItem(key, value); } catch (e2) { console.error('Ainda sem espaço após limpar cache'); }
      }
    }
  };
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  const [alertModal, setAlertModal] = useState<{
    show: boolean;
    title: string;
    message: string;
  }>({ show: false, title: '', message: '' });

  const showAlert = (title: string, message: string) => {
    setAlertModal({ show: true, title, message });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ show: true, title, message, onConfirm });
  };

  const handleImageDrop = async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      setCurrentPromptThumbnail(base64);
      
      const info = await extractImageMetadata(file);
      if (info) {
        showConfirm('Extrair Metadados', 'Deseja extrair os metadados desta imagem?', () => {
          const parsed = parseSDParameters(info);
          const input = document.getElementById('input') as HTMLTextAreaElement;
          const negativeInput = document.getElementById('negativeInput') as HTMLTextAreaElement;
          if (input) {
            input.value = parsed.prompt;
            const event = new Event('input', { bubbles: true });
            input.dispatchEvent(event);
          }
          if (negativeInput) {
            negativeInput.value = parsed.negative;
          }
          setCurrentAdvanced({
            baseModel: parsed.baseModel,
            loras: parsed.loras,
            cfgScale: parsed.cfgScale,
            steps: parsed.steps,
            sampler: parsed.sampler,
            seed: parsed.seed,
            otherParams: parsed.otherParams
          });
          setShowAdvanced(true);
        });
      }
    } catch (err) {
      console.error('Erro no processamento da imagem:', err);
    }
  };

  useEffect(() => {
    const input = document.getElementById('input') as HTMLTextAreaElement;
    const inputBackdrop = document.getElementById('inputBackdrop') as HTMLDivElement;
    const tagsContainer = document.getElementById('tagsContainer') as HTMLDivElement;

    // Drag and Drop logic
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      // Only set to false if we actually left the window
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      try {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith('image/')) {
            await handleImageDrop(file);
          }
        }
      } catch (err) {
        console.error('Erro no handleDrop:', err);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    // Load initial presets
    let savedPresets = [];
    try {
      const data = localStorage.getItem('tagmaster_presets');
      console.log('Loaded from localStorage:', data);
      savedPresets = JSON.parse(data || '[]');
    } catch (e) {
      console.error('Erro ao carregar presets do localStorage:', e);
    }
    setPresets(savedPresets);

    if (input && inputBackdrop) {
      input.onscroll = () => {
        inputBackdrop.scrollTop = input.scrollTop;
        inputBackdrop.scrollLeft = input.scrollLeft;
      };
      
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (input && inputBackdrop) {
            inputBackdrop.style.width = input.offsetWidth + 'px';
            inputBackdrop.style.height = input.offsetHeight + 'px';
          }
        });
      });
      ro.observe(input);
    }
    const trashContainer = document.getElementById('trashContainer') as HTMLDivElement;
    const copyPromptBtn = document.getElementById('copyPromptBtn') as HTMLButtonElement;
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
    const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
    const darkModeBtn = document.getElementById('darkModeBtn') as HTMLButtonElement;
    const tokenCounter = document.getElementById('tokenCounter') as HTMLDivElement;
    const charCounter = document.getElementById('charCounter') as HTMLDivElement;
    const librarySearchInput = document.getElementById('librarySearchInput') as HTMLInputElement;
    const libraryGroupsContainer = document.getElementById('libraryGroupsContainer') as HTMLDivElement;
    const compareBtn = document.getElementById('compareBtn') as HTMLButtonElement;
    const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
    const settingsModal = document.getElementById('settingsModal') as HTMLDivElement;
    const compareModal = document.getElementById('compareModal') as HTMLDivElement;
    const compareBase = document.getElementById('compareBase') as HTMLTextAreaElement;
    const compareDiff = document.getElementById('compareDiff') as HTMLDivElement;
    const promptNotes = document.getElementById('promptNotes') as HTMLTextAreaElement;
    const addCatBtn = document.getElementById('addCatBtn') as HTMLButtonElement;
    const presetsBarVertical = document.getElementById('presetsBarVertical') as HTMLDivElement;
    const importInput = document.getElementById('importInput') as HTMLTextAreaElement;
    const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
    const importTitle = document.getElementById('importTitle') as HTMLInputElement;
    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

    let libraryData: Record<string, string[]> = {};
    let libraryCategoryNames: Record<string, string> = {};
    let libraryCategoryColors: Record<string, string> = {};
    let wildcardLists: Record<string, string[]> = {};

    async function loadExternalLibrary() {
      console.log('Iniciando carregamento da biblioteca externa...');
      try {
        // Sincroniza a biblioteca antes de carregar o índice
        try {
          await fetch('/api/library/sync');
          // Pequeno delay para garantir que o sistema de arquivos estabilizou
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (e) {
          console.warn('Erro ao sincronizar biblioteca:', e);
        }

        const indexResponse = await fetch(`/library_index.json?t=${Date.now()}`);
        if (!indexResponse.ok) throw new Error(`HTTP error! status: ${indexResponse.status}`);
        const items: { file: string, name: string, color: string, enabled?: boolean }[] = await indexResponse.json();
        
        libraryData = {};
        libraryCategoryNames = {};
        libraryCategoryColors = {};
        
        for (const item of items) {
          if (item.enabled === false) continue;
          
          let success = false;
          let attempts = 0;
          const maxAttempts = 2;
          
          while (!success && attempts < maxAttempts) {
            try {
              const res = await fetch(`/${item.file}?t=${Date.now()}`);
              if (!res.ok) {
                attempts++;
                continue;
              }
              const text = await res.text();
              const lines = text.split('\n').map(l => l.trim()).filter(l => l);
              if (lines.length === 0) {
                success = true; // Arquivo vazio, mas fetch ok
                continue;
              }
              
              const tags: string[] = [];
              lines.forEach(line => {
                if (line.startsWith('\\\\')) {
                  tags.push(line);
                } else if (line.includes(':')) {
                  const [tagKey, trans] = line.split(':').map(s => s.trim());
                  if (tagKey) {
                    tags.push(tagKey);
                    if (trans) {
                      const cleanKey = tagKey.toLowerCase().replace(/_/g, ' ');
                      translationCache[cleanKey] = trans;
                    }
                  }
                } else {
                  tags.push(line);
                }
              });
              
              try {
                localStorage.setItem('tagmaster_translations', JSON.stringify(translationCache));
              } catch (e) {
                console.error('Erro ao salvar cache de tradução:', e);
              }
              
              const key = item.file.replace('.txt', '');
              
              libraryData[key] = tags;
              libraryCategoryNames[key] = item.name;
              libraryCategoryColors[key] = item.color;
              success = true;
            } catch (err) {
              attempts++;
              if (attempts >= maxAttempts) {
                console.error(`Erro ao carregar arquivo ${item.file}:`, err);
              } else {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }
          }
        }
        
        console.log('Biblioteca processada, chamando initLibrary...');
        initLibrary();
      } catch (error) {
        console.error('Erro ao carregar índice da biblioteca externa:', error);
        // Fallback para dados básicos se o fetch falhar
        libraryData = {
          loras: ['<lora:pony_xl:1.0>', '<lora:illustro:1.0>'],
          negative: ['worst quality', 'low quality'],
          score: ['score_9', 'score_8_up']
        };
        libraryCategoryNames = { loras: '🔌 LoRAs', negative: 'Negative', score: 'Score' };
        libraryCategoryColors = { loras: '#8b5cf6', negative: '#ef4444', score: '#3b82f6' };
        initLibrary();
      }
    }

    let history: string[] = [], historyIndex = -1, isUpdatingFromCode = false;
    let selectedTags = new Set<HTMLElement>();
    let customCategories: Record<string, string[]> = {};
    let presets: { id: number; name: string; prompt: string; notes: string; image?: string }[] = [];
    const tagToColorMap = new Map<string, string>();
    const selectedLibraryTags = new Set<string>();

    function updateLibrarySelectionUI() {
      const bar = document.getElementById('librarySelectionBar');
      const count = document.getElementById('librarySelectionCount');
      if (!bar || !count) return;
      if (selectedLibraryTags.size > 0) {
        bar.style.display = 'flex';
        count.textContent = `${selectedLibraryTags.size} selecionadas`;
      } else {
        bar.style.display = 'none';
      }
    }

    function addSelectedLibraryTags() {
      if (selectedLibraryTags.size === 0) return;
      selectedLibraryTags.forEach(t => addTag(t));
      selectedLibraryTags.clear();
      
      document.querySelectorAll('.lib-tag.selected-for-add').forEach(el => {
        el.classList.remove('selected-for-add');
      });
      
      updateLibrarySelectionUI();
      
      const modal = document.getElementById('libraryModal');
      if (modal) modal.classList.remove('active');
    }

    // Attach to the button we just created in HTML
    setTimeout(() => {
      const btn = document.getElementById('addSelectedTagsBtn');
      if (btn) btn.onclick = addSelectedLibraryTags;
    }, 100);

    function loadStorage() {
      try { 
        customCategories = JSON.parse(localStorage.getItem('tagmaster_custom_cats') || '{}'); 
      } catch(e) { 
        customCategories = {}; 
      }
      
      let storedPresets = null;
      try {
        storedPresets = localStorage.getItem('tagmaster_presets');
      } catch (e) {
        console.error('Erro ao carregar presets:', e);
      }

      if (!storedPresets) {
        presets = [
          { id: 1, name: "Anime Girl Básico", prompt: "Uma garota anime linda, masterpiece, best quality, detailed face, BREAK background: city night, neon lights", notes: "" },
          { id: 2, name: "Portrait Realista", prompt: "Realistic portrait of a woman, (photorealistic:1.3), sharp focus, <lora:epi_noiseoffset_v2:0.5>, BREAK ultra detailed skin", notes: "" },
          { id: 3, name: "Cyberpunk Samurai", prompt: "Cyberpunk samurai, cyberpunk style, neon glow, (sword:1.2), BREAK dark alley, rain", notes: "" },
          { id: 4, name: "Fantasy Dragon", prompt: "Fantasy dragon flying, epic, detailed scales, fire breath, BREAK mountains, sunset sky", notes: "" }
        ];
        try {
          safeSetItem('tagmaster_presets', JSON.stringify(presets));
        } catch (e) {
          console.error('Erro ao salvar presets iniciais:', e);
        }
      } else {
        try { presets = JSON.parse(storedPresets); } catch(e) { presets = []; }
      }

      let isDark = false;
      try {
        isDark = localStorage.getItem('tagmaster_dark_mode') === '1';
      } catch (e) {
        console.error('Erro ao carregar dark_mode:', e);
      }

      if (isDark) {
        document.body.classList.add('dark-mode');
        darkModeBtn.textContent = '☀️ Modo Claro';
      }
    }
    loadStorage();

    function makeCategoryHeader(label: string, tags: string[], options: { onAddSingle?: () => void, onImportAll?: () => void, onDelete?: () => void, onToggle?: () => void } = {}, color?: string) {
      const header = document.createElement('h4');
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      
      const titleWrap = document.createElement('div');
      titleWrap.className = 'category-title-wrap';
      titleWrap.style.display = 'flex';
      titleWrap.style.alignItems = 'center';
      titleWrap.style.gap = '8px';
      titleWrap.style.flex = '1';
      titleWrap.onclick = options.onToggle || null;

      const arrow = document.createElement('span');
      arrow.className = 'category-arrow';
      arrow.textContent = '▼';
      arrow.style.fontSize = '0.8em';
      arrow.style.transition = 'transform 0.2s';
      titleWrap.appendChild(arrow);

      if (color) {
        const colorDot = document.createElement('div');
        colorDot.style.cssText = `width:12px;height:12px;border-radius:50%;background-color:${color};flex-shrink:0;`;
        titleWrap.appendChild(colorDot);
      }

      const titleContent = document.createElement('div');
      titleContent.className = 'category-title-content';
      titleContent.style.display = 'flex';
      titleContent.style.flexDirection = 'column';

      const title = document.createElement('span');
      title.className = 'category-title-main';
      title.textContent = label;
      titleContent.appendChild(title);

      // Add translation for category title if it's a known one
      const trans = document.createElement('span');
      trans.className = 'category-title-translation';
      trans.style.fontSize = '0.8em';
      trans.style.opacity = '0.6';
      trans.style.fontWeight = '400';
      
      // Simple mapping for predefined categories
      const titleTranslations: Record<string, string> = {
        'Qualidade': 'Quality',
        'Ângulos de Câmera': 'Camera Angles',
        'Câmera e Enquadramento': 'Camera and Framing',
        'Ação entre Personagens': 'Character Action',
        'Personagem': 'Character',
        'Background e Cenário': 'Background and Scenery'
      };
      
      // If the label is in Portuguese, show English as translation, and vice versa
      // But usually categories are in Portuguese in the UI
      if (titleTranslations[label]) {
        trans.textContent = titleTranslations[label];
      } else {
        // Try to translate if it's not predefined
        fetchGoogleTranslation(label).then(translated => {
          if (translated) {
            trans.textContent = translated;
          }
        }).catch(err => console.error('Erro na tradução do título:', err));
      }
      titleContent.appendChild(trans);
      
      titleWrap.appendChild(titleContent);
      
      header.appendChild(titleWrap);

      const btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'display:flex;gap:5px;align-items:center;flex-shrink:0;';

      const importAllBtn = document.createElement('button');
      importAllBtn.className = 'btn btn-primary';
      importAllBtn.style.cssText = 'padding:2px 10px;font-size:0.75em';
      importAllBtn.title = 'Adicionar todas as tags da categoria ao prompt';
      importAllBtn.textContent = '⬇️ Todas';
      importAllBtn.onclick = options.onImportAll || null;
      btnWrap.appendChild(importAllBtn);

      if (options.onAddSingle) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-success';
        addBtn.style.cssText = 'padding:2px 8px;font-size:0.75em';
        addBtn.title = 'Adicionar nova tag à categoria';
        addBtn.textContent = '➕';
        addBtn.onclick = options.onAddSingle;
        btnWrap.appendChild(addBtn);
      }

      if (options.onDelete) {
        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'padding:2px 8px;font-size:0.75em;background:#dc3545;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;';
        delBtn.title = 'Excluir esta categoria';
        delBtn.textContent = '🗑️';
        delBtn.onclick = options.onDelete;
        btnWrap.appendChild(delBtn);
      }

      header.appendChild(btnWrap);
      return header;
    }

    function initLibrary() {
      if (!libraryGroupsContainer) {
        console.error('libraryGroupsContainer não encontrado!');
        return;
      }
      console.log('Populando biblioteca...');
      libraryGroupsContainer.innerHTML = '';
      
      const allCategories = { ...customCategories };
      const customKeys = Object.keys(allCategories);
      const libKeys = Object.keys(libraryData);
      
      console.log(`Categorias customizadas: ${customKeys.length}, Categorias da biblioteca: ${libKeys.length}`);
      
      let totalTags = 0;
      customKeys.forEach(cat => {
        if (Array.isArray(allCategories[cat])) {
          totalTags += allCategories[cat].filter(t => !t.startsWith('\\\\')).length;
        }
      });
      libKeys.forEach(k => {
        if (Array.isArray(libraryData[k])) {
          totalTags += libraryData[k].filter(t => !t.startsWith('\\\\')).length;
        }
      });
      
      const counterEl = document.getElementById('libTagCounter');
      if (counterEl) counterEl.textContent = `${totalTags} tags`;

      tagToColorMap.clear();

      customKeys.forEach(cat => {
        const tags = allCategories[cat];
        if (!Array.isArray(tags)) return;
        const group = document.createElement('div'); group.className = 'library-group collapsed';
        const tagContainer = document.createElement('div'); tagContainer.className = 'library-tags';
        
        // Custom categories don't have a specific color yet, but we could add it later.
        // For now, let's assign a default color or leave it empty.
        const catColor = '#4b5563'; // default gray for custom
        tags.forEach(t => {
          if (t.startsWith('\\\\')) return;
          const base = t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
          tagToColorMap.set(base, catColor);
        });

        let rendered = false;
        const renderTags = () => {
          if (rendered) return;
          tags.forEach(t => {
            if (t.startsWith('\\\\')) {
              const sep = document.createElement('div');
              sep.className = 'lib-tag-separator';
              sep.style.cssText = 'width: 100%; text-align: center; font-size: 0.85em; font-weight: 600; color: var(--text-muted); margin: 12px 0 4px 0; display: flex; align-items: center;';
              const line1 = document.createElement('div'); line1.style.cssText = 'flex: 1; height: 1px; background: var(--border-color); margin-right: 10px;';
              const line2 = document.createElement('div'); line2.style.cssText = 'flex: 1; height: 1px; background: var(--border-color); margin-left: 10px;';
              const text = document.createElement('span'); text.textContent = t.substring(2).trim();
              sep.appendChild(line1); sep.appendChild(text); sep.appendChild(line2);
              tagContainer.appendChild(sep);
              return;
            }
            const item = document.createElement('div'); item.className = 'lib-tag';
            if (selectedLibraryTags.has(t)) item.classList.add('selected-for-add');
            
            item.style.borderLeft = `4px solid ${catColor}`;
            
            const mainText = document.createElement('div'); mainText.textContent = t;
            const transText = document.createElement('div'); transText.className = 'lib-tag-translation';
            updateTranslationElement(transText, t);
            item.appendChild(mainText); item.appendChild(transText);
            
            item.onclick = () => {
              if (selectedLibraryTags.has(t)) {
                selectedLibraryTags.delete(t);
                item.classList.remove('selected-for-add');
              } else {
                selectedLibraryTags.add(t);
                item.classList.add('selected-for-add');
              }
              updateLibrarySelectionUI();
            };
            
            item.oncontextmenu = (e) => {
              e.preventDefault();
              customCategories[cat] = customCategories[cat].filter(x => x !== t);
              localStorage.setItem('tagmaster_custom_cats', JSON.stringify(customCategories));
              initLibrary();
            };
            tagContainer.appendChild(item);
          });
          rendered = true;
        };

        group.appendChild(makeCategoryHeader(cat, tags, {
          onToggle: () => {
            renderTags();
            group.classList.toggle('collapsed');
          },
          onImportAll: () => tags.forEach(t => { if (!t.startsWith('\\\\')) addTag(t); }),
          onAddSingle: () => addTagToCategory(cat),
          onDelete: () => {
            showConfirm('Excluir Categoria', `Excluir a categoria "${cat}" e todas as suas ${tags.length} tag(s)?`, () => {
              delete customCategories[cat];
              try {
                localStorage.setItem('tagmaster_custom_cats', JSON.stringify(customCategories));
              } catch (e) {
                console.error('Erro ao salvar no localStorage:', e);
              }
              initLibrary();
            });
          }
        }, catColor));

        group.appendChild(tagContainer);
        (group as any)._renderTags = renderTags; // Store for search
        libraryGroupsContainer.appendChild(group);
      });

      libKeys.forEach(k => {
        const tags = libraryData[k];
        if (!Array.isArray(tags)) return;
        const group = document.createElement('div'); group.className = 'library-group collapsed';
        const tagContainer = document.createElement('div'); tagContainer.className = 'library-tags';
        
        // Use the color from the .txt file or fallback to default
        let catColor = libraryCategoryColors[k] || '#3b82f6';
        
        tags.forEach(t => {
          if (t.startsWith('\\\\')) return;
          const base = t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
          tagToColorMap.set(base, catColor);
        });

        let rendered = false;
        const renderTags = () => {
          if (rendered) return;
          tags.forEach(t => {
            if (t.startsWith('\\\\')) {
              const sep = document.createElement('div');
              sep.className = 'lib-tag-separator';
              sep.style.cssText = 'width: 100%; text-align: center; font-size: 0.85em; font-weight: 600; color: var(--text-muted); margin: 12px 0 4px 0; display: flex; align-items: center;';
              const line1 = document.createElement('div'); line1.style.cssText = 'flex: 1; height: 1px; background: var(--border-color); margin-right: 10px;';
              const line2 = document.createElement('div'); line2.style.cssText = 'flex: 1; height: 1px; background: var(--border-color); margin-left: 10px;';
              const text = document.createElement('span'); text.textContent = t.substring(2).trim();
              sep.appendChild(line1); sep.appendChild(text); sep.appendChild(line2);
              tagContainer.appendChild(sep);
              return;
            }
            const item = document.createElement('div'); item.className = 'lib-tag';
            if (selectedLibraryTags.has(t)) item.classList.add('selected-for-add');
            
            item.style.borderLeft = `4px solid ${catColor}`;
            
            const mainText = document.createElement('div'); mainText.textContent = t;
            const transText = document.createElement('div'); transText.className = 'lib-tag-translation';
            updateTranslationElement(transText, t);
            item.appendChild(mainText); item.appendChild(transText);
            
            item.onclick = () => {
              if (selectedLibraryTags.has(t)) {
                selectedLibraryTags.delete(t);
                item.classList.remove('selected-for-add');
              } else {
                selectedLibraryTags.add(t);
                item.classList.add('selected-for-add');
              }
              updateLibrarySelectionUI();
            };
            tagContainer.appendChild(item);
          });
          rendered = true;
        };

        group.appendChild(makeCategoryHeader(libraryCategoryNames[k] || k, tags, {
          onToggle: () => {
            renderTags();
            group.classList.toggle('collapsed');
          },
          onImportAll: () => tags.forEach(t => { if (!t.startsWith('\\\\')) addTag(t); })
        }, catColor));

        group.appendChild(tagContainer);
        (group as any)._renderTags = renderTags; // Store for search
        libraryGroupsContainer.appendChild(group);
      });
      console.log('Biblioteca populada com sucesso. Total de grupos:', libraryGroupsContainer.children.length);
    }

    function updateBackdrop() {
      if (!inputBackdrop) return;
      const val = input.value;
      const selectedTexts = Array.from(selectedTags).map(t => {
        const inp = t.querySelector('input:not([type="range"])') as HTMLInputElement;
        return inp ? inp.value.trim() : '';
      }).filter(t => t);

      if (selectedTexts.length === 0) {
        inputBackdrop.innerHTML = val.replace(/\n/g, '<br/>') + ' ';
        tagsContainer.classList.remove('multiple-selected');
        return;
      }
      
      tagsContainer.classList.toggle('multiple-selected', selectedTags.size > 1);

      // Escape HTML
      let escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      // Highlight selected tags
      // We need to be careful with overlapping or multiple occurrences
      // For simplicity, we'll highlight all occurrences of the selected tag texts
      selectedTexts.forEach(text => {
        if (!text) return;
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Use a regex that matches the text as a whole word or surrounded by separators
        const regex = new RegExp(`(${escapedText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'g');
        escaped = escaped.replace(regex, '<mark>$1</mark>');
      });

      inputBackdrop.innerHTML = escaped.replace(/\n/g, '<br/>') + ' ';
    }

    function createTagElement(text: string, freq = 1, errors = { hasGluedBreak: false, hasGluedLoras: false, unbalancedParens: false, openParens: 0, closeParens: 0 }) {
      const isLayer = text.startsWith('[') && text.endsWith(']');
      const tag = document.createElement('div'); 
      tag.className = isLayer ? 'tag layer' : 'tag';
      
      tag.onclick = (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.tag-actions') || target.closest('.tag-handle') || target.closest('.tag-warning-badge')) return;
        if (isLayer) return; // Layers are not selectable for prompt grouping
        if (!e.shiftKey) { selectedTags.forEach(t => t.classList.remove('selected')); selectedTags.clear(); }
        if (selectedTags.has(tag)) { 
          tag.classList.remove('selected'); 
          selectedTags.delete(tag); 
        } else { 
          tag.classList.add('selected'); 
          selectedTags.add(tag); 
        }
        updateBackdrop();
      };

      const contentWrap = document.createElement('div');
      contentWrap.className = 'content-wrap';
      contentWrap.style.display = 'flex';
      contentWrap.style.flexDirection = 'column';
      contentWrap.style.alignItems = isLayer ? 'center' : 'flex-start';
      if (isLayer) contentWrap.style.width = '100%';

      const inp = document.createElement('input');
      inp.value = text;
      if (isLayer) {
        inp.style.textAlign = 'center';
        inp.style.fontWeight = '700';
        inp.style.fontSize = '1.1em';
        inp.style.width = '100%';
      }
      inp.oninput = () => { 
        adjustWidth(inp); 
        updateTextarea(); 
        updateTagClasses(tag, inp.value);
        if (!isLayer) updateTranslationElement(trans, inp.value);

        const timeoutId = (window as any).chipSyncTimeout;
        clearTimeout(timeoutId);
        (window as any).chipSyncTimeout = setTimeout(() => {
          if (inp.value.trim().endsWith(',')) return;

          const activeEl = document.activeElement as HTMLInputElement;
          let focusIndex = -1;
          let cursorStart = 0;
          let cursorEnd = 0;
          let hadComma = inp.value.includes(',');

          if (activeEl === inp) {
            const inputs = Array.from(tagsContainer.querySelectorAll('.tag input:not([type="range"])'));
            focusIndex = inputs.indexOf(activeEl);
            cursorStart = activeEl.selectionStart || 0;
            cursorEnd = activeEl.selectionEnd || 0;
          }

          updateTagsFromInput(true);

          if (focusIndex !== -1) {
            const newInputs = Array.from(tagsContainer.querySelectorAll('.tag input:not([type="range"])')) as HTMLInputElement[];
            let targetIndex = focusIndex;
            
            if (hadComma) {
              const commaIdx = inp.value.indexOf(',');
              if (cursorStart > commaIdx) {
                targetIndex = focusIndex + 1;
                cursorStart = Math.max(0, cursorStart - commaIdx - 1);
                cursorEnd = Math.max(0, cursorEnd - commaIdx - 1);
              }
            }
            
            if (newInputs[targetIndex]) {
              newInputs[targetIndex].focus();
              try {
                newInputs[targetIndex].setSelectionRange(cursorStart, cursorEnd);
              } catch (e) {}
            } else if (newInputs[focusIndex]) {
              newInputs[focusIndex].focus();
            }
          }
        }, 150);
      };

      const trans = document.createElement('div');
      trans.className = 'tag-translation';
      if (!isLayer) updateTranslationElement(trans, text);

      if (isLayer) {
        const delBtn = document.createElement('div');
        delBtn.className = 'tag-actions';
        delBtn.innerHTML = '×';
        delBtn.style.cssText = 'position:absolute; top:-8px; right:-8px; background:var(--red); color:white; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; font-weight:bold;';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          tag.remove();
          updateTextarea();
          saveState();
        };
        tag.appendChild(delBtn);
      }
      
      contentWrap.appendChild(inp);
      if (!isLayer) contentWrap.appendChild(trans);

      if (freq > 1) {
        const badge = document.createElement('div');
        badge.className = 'tag-duplicate-badge';
        badge.textContent = `${freq}x`;
        badge.title = `Tag duplicada: '${text}' aparece ${freq} vezes. Deseja remover uma?`;
        tag.appendChild(badge);
      }

      if (errors.hasGluedBreak || errors.hasGluedLoras || errors.unbalancedParens) {
        const warn = document.createElement('div');
        warn.className = 'tag-warning-badge';
        warn.textContent = '⚠️';
        
        let msg = '';
        if (errors.hasGluedBreak) msg = 'Possível erro: falta separador após BREAK';
        else if (errors.hasGluedLoras) msg = 'Possível erro: LoRAs sem separador';
        else if (errors.unbalancedParens) msg = 'Parêntese desbalanceado';
        warn.title = msg + ' (Clique para corrigir)';
        
        warn.onclick = (e) => {
          e.stopPropagation();
          let fixed = text;
          if (errors.hasGluedBreak) {
            fixed = fixed.replace(/BREAK/g, ', BREAK, ').replace(/,\s*,/g, ',');
          }
          if (errors.hasGluedLoras) {
            fixed = fixed.replace(/><lora:/g, '>, <lora:');
          }
          if (errors.unbalancedParens) {
            if (errors.openParens > errors.closeParens) fixed = fixed + ')'.repeat(errors.openParens - errors.closeParens);
            else if (errors.closeParens > errors.openParens) fixed = '('.repeat(errors.closeParens - errors.openParens) + fixed;
          }
          inp.value = fixed;
          inp.oninput(new Event('input'));
          saveState();
        };
        
        tag.appendChild(warn);
      }

      const actions = document.createElement('div'); actions.className = 'tag-actions';
      if (isLayer) actions.style.display = 'none';

      const parenBtn = document.createElement('button'); parenBtn.className = 'tag-btn'; parenBtn.textContent = '( )';
      parenBtn.onclick = (e) => {
        e.stopPropagation();
        let v = inp.value.trim();
        if (v.startsWith('((')) {
          v = v.slice(2, -2);
        } else if (v.startsWith('(')) {
          v = `(${v})`;
        } else {
          v = `(${v})`;
        }
        inp.value = v; inp.oninput(new Event('input')); saveState();
      };

      const loraBtn = document.createElement('button'); loraBtn.className = 'tag-btn'; loraBtn.textContent = 'LoRA';
      loraBtn.style.width = 'auto'; loraBtn.style.padding = '0 8px'; loraBtn.style.fontSize = '10px';
      loraBtn.onclick = (e) => {
        e.stopPropagation();
        let v = inp.value.trim();
        if (v.startsWith('<lora:') && v.endsWith('>')) {
          const match = v.match(/^<lora:([^:]+)/);
          if (match) {
            inp.value = match[1];
          } else {
            inp.value = v.replace(/^<lora:/, '').replace(/:[^>]+>$/, '').replace(/>$/, '');
          }
        } else {
          const clean = v.replace(/^\(+|\)+$/g, '').split(':')[0].trim();
          inp.value = `<lora:${clean}:1.0>`;
        }
        inp.oninput(new Event('input')); saveState();
      };

      const removeBtn = document.createElement('button'); removeBtn.className = 'tag-btn'; removeBtn.textContent = '×';
      removeBtn.onclick = (e) => { e.stopPropagation(); addTagToTrash(inp.value); tag.remove(); updateTextarea(); saveState(); };

      const sliderPop = document.createElement('div'); sliderPop.className = 'tag-slider-popover';
      const sliderLabel = document.createElement('div');
      sliderLabel.style.cssText = 'text-align:center; font-size:0.85em; font-weight:bold; margin-bottom:4px; color:var(--text-color);';
      
      const sliderContainer = document.createElement('div');
      sliderContainer.style.cssText = 'display:flex; align-items:center; gap:4px;';
      
      const btnMinus = document.createElement('button'); btnMinus.textContent = '-'; btnMinus.style.cssText = 'padding:2px 6px; cursor:pointer;';
      const btnPlus = document.createElement('button'); btnPlus.textContent = '+'; btnPlus.style.cssText = 'padding:2px 6px; cursor:pointer;';
      
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '-5'; slider.max = '5'; slider.step = '0.05';
      slider.style.flexGrow = '1';

      btnMinus.onclick = (e) => { e.stopPropagation(); slider.value = (parseFloat(slider.value) - 0.05).toFixed(2); slider.oninput!(e); };
      btnPlus.onclick = (e) => { e.stopPropagation(); slider.value = (parseFloat(slider.value) + 0.05).toFixed(2); slider.oninput!(e); };

      sliderContainer.appendChild(btnMinus);
      sliderContainer.appendChild(slider);
      sliderContainer.appendChild(btnPlus);

      const loraMatch = text.match(/<lora:[^:]+:([0-9.+-]+)>/);
      const weightMatch = text.match(/:([0-9.+-]+)\)/);
      const initVal = loraMatch ? parseFloat(loraMatch[1]) : (weightMatch ? parseFloat(weightMatch[1]) : 1.0);
      slider.value = Math.max(-5, Math.min(5, initVal)).toString();
      sliderLabel.textContent = parseFloat(slider.value).toFixed(2);

      slider.oninput = (e) => {
        e.stopPropagation();
        const w = parseFloat(slider.value).toFixed(2);
        sliderLabel.textContent = w;
        let v = inp.value.trim();
        if (v.startsWith('<lora:')) {
          const match = v.match(/<lora:([^:]+):/);
          const c = match ? match[1] : '';
          inp.value = `<lora:${c}:${w}>`;
        } else {
          const c = v.replace(/^\(+|\)+$/g, '').split(':')[0].trim();
          inp.value = `(${c}:${w})`;
        }
        adjustWidth(inp); updateTextarea(); updateTagClasses(tag, inp.value);
      };
      slider.onchange = (e) => { e.stopPropagation(); saveState(); };

      const popActions = document.createElement('div');
      popActions.style.cssText = 'display:flex; gap:4px; justify-content:center; margin-top:8px;';
      popActions.appendChild(parenBtn);
      popActions.appendChild(loraBtn);

      let originText = '';
      const baseTag = text.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
      if (text.startsWith('<lora:')) {
        originText = '🔌 LoRA';
      } else {
        for (const [catKey, tags] of Object.entries(libraryData)) {
          if (tags.some(t => t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase() === baseTag)) {
            originText = libraryCategoryNames[catKey] || catKey;
            break;
          }
        }
        if (!originText) {
          for (const [catKey, tags] of Object.entries(customCategories)) {
            if (tags.some(t => t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase() === baseTag)) {
              originText = catKey;
              break;
            }
          }
        }
      }

      const originInfo = document.createElement('div');
      originInfo.style.cssText = 'font-size: 0.75em; color: var(--text-faint); text-align: center; margin-top: 8px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      if (originText) {
        originInfo.textContent = `Origem: ${originText}`;
      } else {
        originInfo.textContent = `Origem: Manual`;
      }

      sliderPop.onclick = (e) => e.stopPropagation();
      sliderPop.appendChild(sliderLabel);
      sliderPop.appendChild(sliderContainer);
      sliderPop.appendChild(popActions);
      sliderPop.appendChild(originInfo);
      
      actions.appendChild(removeBtn);

      const handle = document.createElement('span'); handle.className = 'tag-handle'; handle.textContent = '⠿';
      handle.addEventListener('pointerdown', e => startDrag(e, tag));

      tag.appendChild(handle); tag.appendChild(contentWrap); tag.appendChild(actions); tag.appendChild(sliderPop);
      updateTagClasses(tag, text); setTimeout(() => adjustWidth(inp), 0);
      return tag;
    }

    function addTag(text: string) {
      if (text.startsWith('__') && wildcardLists[text]) {
        const l = wildcardLists[text];
        text = l[Math.floor(Math.random() * l.length)];
      }
      const t = createTagElement(text);
      tagsContainer.appendChild(t);
      updateTextarea();
      saveState();
      (t.querySelector('input') as HTMLInputElement).focus();
    }

    function updateTextarea() {
      const ins = Array.from(tagsContainer.querySelectorAll('.tag input:not([type="range"])')) as HTMLInputElement[];
      let result = '';
      
      ins.forEach((i, idx) => {
        const v = i.value.trim();
        if (!v) return;
        
        const isLayerOrBreak = (v.startsWith('[') && v.endsWith(']')) || v.toUpperCase() === 'BREAK';
        
        if (isLayerOrBreak) {
          // If previous was a normal tag, add comma before newline
          if (result && !result.endsWith('\n') && !result.endsWith(', ')) result += ',';
          result += '\n' + v + ',\n';
        } else {
          // If previous was a newline, just add tag
          if (result && !result.endsWith('\n')) result += ', ';
          result += v;
        }
      });
      
      isUpdatingFromCode = true;
      input.value = result.trim();
      isUpdatingFromCode = false;
      updateTokenCount();
      updateBackdrop();
    }

    function updateTagsFromInput(s = true) {
      tagsContainer.innerHTML = '';
      const val = input.value;
      const regex = /([^,\n]+)/g;
      let match;
      
      const tagsList: string[] = [];
      while ((match = regex.exec(val)) !== null) {
        const trimmedText = match[0].trim();
        if (trimmedText) tagsList.push(trimmedText);
      }
      
      const frequencies = new Map<string, number>();
      tagsList.forEach(t => {
        const base = t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
        if (base && base !== 'break' && base !== 'and' && !t.startsWith('[')) {
          frequencies.set(base, (frequencies.get(base) || 0) + 1);
        }
      });
      
      let currentBlockTokens = 0;

      tagsList.forEach(t => {
        const base = t.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
        const freq = frequencies.get(base) || 1;
        
        const hasGluedBreak = t.includes('BREAK') && t !== 'BREAK';
        const hasGluedLoras = /><lora:/.test(t);
        const openParens = (t.match(/\(/g) || []).length;
        const closeParens = (t.match(/\)/g) || []).length;
        const unbalancedParens = openParens !== closeParens;
        
        const tagEl = createTagElement(t, freq, { hasGluedBreak, hasGluedLoras, unbalancedParens, openParens, closeParens });
        tagsContainer.appendChild(tagEl);
        
        let tagTokens = 0;
        if (t.startsWith('<lora:')) {
          tagTokens = 1;
        } else {
          const words = base.split(/[\s_]+/).filter(w => w);
          tagTokens = Math.max(1, words.length);
        }
        currentBlockTokens += tagTokens;
        
        if (t === 'BREAK') {
          const breakBadge = document.createElement('div');
          breakBadge.className = 'break-token-badge';
          breakBadge.textContent = `BREAK ${currentBlockTokens} tokens`;
          tagsContainer.appendChild(breakBadge);
          currentBlockTokens = 0;
        }
      });

      if (s) saveState();
      updateTokenCount();
      updateBackdrop();
    }

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tag') && !target.closest('.prompt-actions')) {
        selectedTags.forEach(t => t.classList.remove('selected'));
        selectedTags.clear();
        updateBackdrop();
      }
    });

    const addLayerBtn = document.getElementById('addLayerBtn') as HTMLButtonElement;
    const groupDropdown = document.getElementById('groupDropdown') as HTMLDivElement;
    if (addLayerBtn && groupDropdown) {
      addLayerBtn.onclick = (e) => {
        e.stopPropagation();
        groupDropdown.style.display = groupDropdown.style.display === 'none' ? 'block' : 'none';
      };
      groupDropdown.querySelectorAll('.dropdown-item').forEach(item => {
        (item as HTMLElement).onclick = (e) => {
          e.stopPropagation();
          const g = item.getAttribute('data-group');
          if (g) {
            addTag(`[${g}]`);
          }
          groupDropdown.style.display = 'none';
        };
      });
      document.addEventListener('click', () => {
        groupDropdown.style.display = 'none';
      });
    }

    // Edit Preset Modal Listeners
    const cancelEditPresetBtn = document.getElementById('cancelEditPresetBtn');
    const editPresetImageInput = document.getElementById('editPresetImage') as HTMLInputElement;
    const editPresetPreview = document.getElementById('editPresetPreview') as HTMLImageElement;

    if (cancelEditPresetBtn) {
      cancelEditPresetBtn.onclick = () => {
        const modal = document.getElementById('editPresetModal');
        if (modal) modal.style.display = 'none';
      };
    }

    if (editPresetImageInput && editPresetPreview) {
      editPresetImageInput.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          try {
            editPresetPreview.src = await fileToBase64(file);
            editPresetPreview.style.display = 'block';
          } catch (err) {
            console.error('Erro ao converter imagem:', err);
          }
        }
      };
    }

    const addBreakBtn = document.getElementById('addBreakBtn') as HTMLButtonElement;
    if (addBreakBtn) {
      addBreakBtn.onclick = (e) => {
        e.stopPropagation();
        addTag('BREAK');
      };
    }

    const addAndBtn = document.getElementById('addAndBtn') as HTMLButtonElement;
    if (addAndBtn) {
      addAndBtn.onclick = (e) => {
        e.stopPropagation();
        addTag('AND');
      };
    }

    const selectAllBtn = document.getElementById('selectAllBtn') as HTMLButtonElement;
    if (selectAllBtn) {
      selectAllBtn.onclick = (e) => {
        e.stopPropagation();
        const allTags = tagsContainer.querySelectorAll('.tag:not(.layer)');
        allTags.forEach(t => {
          t.classList.add('selected');
          selectedTags.add(t as HTMLElement);
        });
        updateBackdrop();
      };
    }

    const toggleLangBtn = document.getElementById('toggleLangBtn') as HTMLButtonElement;
    if (toggleLangBtn) {
      let isReversed = false;
      try {
        isReversed = localStorage.getItem('tagmaster_lang_reversed') === '1';
      } catch (e) {
        console.error('Erro ao carregar lang_reversed:', e);
      }
      
      if (isReversed) {
        tagsContainer.classList.add('lang-reversed');
        libraryGroupsContainer.classList.add('lang-reversed');
      }
      toggleLangBtn.onclick = (e) => {
        e.stopPropagation();
        tagsContainer.classList.toggle('lang-reversed');
        libraryGroupsContainer.classList.toggle('lang-reversed');
        const isReversed = tagsContainer.classList.contains('lang-reversed');
        try {
          localStorage.setItem('tagmaster_lang_reversed', isReversed ? '1' : '0');
        } catch (e) {
          console.error('Erro ao salvar lang_reversed:', e);
        }
      };
    }

    const clearAllBtn = document.getElementById('clearAllBtn') as HTMLButtonElement;
    if (clearAllBtn) {
      clearAllBtn.onclick = (e) => {
        e.stopPropagation();
        showConfirm('Limpar Tudo', 'Tem certeza que deseja limpar todo o prompt, tags e notas?', () => {
          input.value = '';
          promptNotes.value = '';
          trashContainer.innerHTML = '';
          selectedTags.clear();
          updateTagsFromInput(true);
        });
      };
    }

    // Tabs Logic
    const tabTagsBtn = document.getElementById('tabTagsBtn');
    const tabPromptsBtn = document.getElementById('tabPromptsBtn');
    const tabCardsBtn = document.getElementById('tabCardsBtn');
    const tabTagsContent = document.getElementById('tabTagsContent');
    const tabPromptsContent = document.getElementById('tabPromptsContent');
    const tabCardsContent = document.getElementById('tabCardsContent');

    function switchTab(activeBtn: HTMLElement | null, activeContent: HTMLElement | null) {
      [tabTagsBtn, tabPromptsBtn, tabCardsBtn].forEach(b => b?.classList.remove('active'));
      [tabTagsContent, tabPromptsContent, tabCardsContent].forEach(c => c?.classList.remove('active'));
      activeBtn?.classList.add('active');
      activeContent?.classList.add('active');
    }

    tabTagsBtn?.addEventListener('click', () => switchTab(tabTagsBtn, tabTagsContent));
    tabPromptsBtn?.addEventListener('click', () => switchTab(tabPromptsBtn, tabPromptsContent));
    tabCardsBtn?.addEventListener('click', () => switchTab(tabCardsBtn, tabCardsContent));

    function adjustWidth(i: HTMLInputElement) {
      const s = document.createElement('span');
      s.style.visibility = 'hidden'; s.style.position = 'absolute'; s.style.whiteSpace = 'pre';
      s.style.font = window.getComputedStyle(i).font;
      s.textContent = i.value || i.placeholder;
      document.body.appendChild(s);
      i.style.width = (s.offsetWidth + 12) + 'px';
      document.body.removeChild(s);
    }

    function lerpColor(a: number[], b: number[], t: number) {
      t = Math.max(0, Math.min(1, t));
      const r = Math.round(a[0] + (b[0] - a[0]) * t);
      const g = Math.round(a[1] + (b[1] - a[1]) * t);
      const bl = Math.round(a[2] + (b[2] - a[2]) * t);
      return [r, g, bl];
    }

    function hexToHsl(hex: string) {
      let r = 0, g = 0, b = 0;
      if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
      } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
      }
      r /= 255; g /= 255; b /= 255;
      let max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0, l = (max + min) / 2;
      if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return { h: h * 360, s: s * 100, l: l * 100 };
    }

    function tagColorForWeight(w: number, hexColor?: string) {
      let h = 220, s = 20, baseL = 25;
      if (hexColor) {
        const hsl = hexToHsl(hexColor);
        h = hsl.h; s = hsl.s; baseL = hsl.l;
      }
      let l = baseL - (w - 1.0) * 30;
      l = Math.max(10, Math.min(90, l));
      let fgL = l > 50 ? 10 : 90;
      return { bg: `hsl(${h}, ${s}%, ${l}%)`, fg: `hsl(${h}, 10%, ${fgL}%)` };
    }

    function loraColorForWeight(w: number) {
      let l = 25 - (w - 1.0) * 30;
      l = Math.max(10, Math.min(90, l));
      let fgL = l > 50 ? 10 : 90;
      return { bg: `hsl(280, 40%, ${l}%)`, fg: `hsl(280, 10%, ${fgL}%)` };
    }

    function applyTagColor(tagEl: HTMLElement, v: string) {
      tagEl.classList.remove('normal','lora','break','and','layer');
      if (v.startsWith('[') && v.endsWith(']')) {
        tagEl.classList.add('layer');
        tagEl.style.background = ''; tagEl.style.color = '';
        return;
      }
      if (v.toLowerCase() === 'break') {
        tagEl.classList.add('break');
        tagEl.style.background = ''; tagEl.style.color = '';
        return;
      }
      if (v.toLowerCase() === 'and') {
        tagEl.classList.add('and');
        tagEl.style.background = ''; tagEl.style.color = '';
        return;
      }
      const base = v.replace(/^\(+|\)+$/g, '').split(':')[0].trim().toLowerCase();
      const catColor = tagToColorMap.get(base);

      if (v.startsWith('<lora:')) {
        const m = v.match(/<lora:[^:]+:([0-9.+-]+)>/);
        const w = m ? parseFloat(m[1]) : 1.0;
        const { bg, fg } = loraColorForWeight(w);
        tagEl.style.background = bg; tagEl.style.color = fg;
        return;
      }
      const m = v.match(/\(([^:]+):([0-9.+-]+)\)/);
      if (m) {
        const w = parseFloat(m[2]);
        const { bg, fg } = tagColorForWeight(w, catColor);
        tagEl.style.background = bg; tagEl.style.color = fg;
        return;
      }
      const { bg, fg } = tagColorForWeight(1.0, catColor);
      tagEl.style.background = bg; tagEl.style.color = fg;
    }

    function updateTagClasses(t: HTMLElement, v: string) { applyTagColor(t, v); }

    function addTagToTrash(t: string) {
      const div = document.createElement('div'); div.className = 'tag normal';
      const inp = document.createElement('input'); inp.value = t; inp.readOnly = true;
      div.appendChild(inp);
      div.onclick = () => { addTag(t); div.remove(); };
      trashContainer.appendChild(div);
    }

    function estimateTokens(promptStr: string) {
      if (!promptStr.trim()) return 0;
      const tags = promptStr.split(',').map(t => t.trim()).filter(t => t && !(t.startsWith('[') && t.endsWith(']')));
      let total = 0;
      tags.forEach(tag => {
        const clean = tag.replace(/^\(+|\)+$/g, '').replace(/:[0-9.]+$/, '').trim();
        if (clean.startsWith('<lora:')) { total += 1; return; }
        const words = clean.split(/[\s_]+/).filter(w => w);
        total += Math.max(1, words.length);
      });
      return total;
    }

    function updateTokenCount() {
      const val = input.value;
      const c = estimateTokens(val);
      tokenCounter.textContent = `Tokens: ~${c} / 75`;
      tokenCounter.className = c > 75 ? 'counter-badge danger' : (c > 60 ? 'counter-badge warning' : 'counter-badge');
      charCounter.textContent = `Caracteres: ${val.length}`;
    }

    function saveState() {
      if (isUpdatingFromCode) return;
      const s = input.value;
      if (historyIndex >= 0 && history[historyIndex] === s) return;
      history = history.slice(0, historyIndex + 1);
      history.push(s);
      historyIndex = history.length - 1;
      undoBtn.disabled = historyIndex <= 0;
      redoBtn.disabled = historyIndex >= history.length - 1;
      updateTokenCount();
    }

    undoBtn.onclick = () => { if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; updateTagsFromInput(false); } };
    redoBtn.onclick = () => { if (historyIndex < history.length - 1) { historyIndex++; input.value = history[historyIndex]; updateTagsFromInput(false); } };

    darkModeBtn.onclick = () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      darkModeBtn.textContent = isDark ? '☀️ Modo Claro' : '🌙 Modo Noturno';
      try {
        localStorage.setItem('tagmaster_dark_mode', isDark ? '1' : '0');
      } catch (e) {
        console.error('Erro ao salvar dark_mode:', e);
      }
    };

    // Button wiring moved to document click listener

    const reloadLibBtn = document.getElementById('reloadLibBtn') as HTMLButtonElement;

    reloadLibBtn.onclick = () => {
      const originalText = reloadLibBtn.textContent;
      reloadLibBtn.textContent = '...';
      loadExternalLibrary().then(() => {
        setTimeout(() => reloadLibBtn.textContent = originalText, 500);
      }).catch(err => console.error('Erro no reloadLibBtn:', err));
    };

    addCatBtn.onclick = () => {
      setShowCreateCategoryModal(true);
    };

    function addTagToCategory(n: string) {
      const t = prompt('Tag:');
      if (t) {
        customCategories[n].push(t);
        try {
          localStorage.setItem('tagmaster_custom_cats', JSON.stringify(customCategories));
        } catch (e) {}
        initLibrary();
      }
    }

    if (settingsBtn && settingsModal) {
      settingsBtn.onclick = () => {
        settingsModal.style.display = 'flex';
      };
    }

    const fontSizePrimary = document.getElementById('fontSizePrimary') as HTMLInputElement;
    const fontSizeSecondary = document.getElementById('fontSizeSecondary') as HTMLInputElement;
    const fontSizePrimaryVal = document.getElementById('fontSizePrimaryVal') as HTMLSpanElement;
    const fontSizeSecondaryVal = document.getElementById('fontSizeSecondaryVal') as HTMLSpanElement;

    if (fontSizePrimary && fontSizeSecondary) {
      // Load preferences
      const savedPrimary = storageGet('tagmaster_font_primary') || '1';
      const savedSecondary = storageGet('tagmaster_font_secondary') || '0.7';
      
      function storageGet(key: string) {
        try { return localStorage.getItem(key); } catch(e) { return null; }
      }
      function storageSet(key: string, val: string) {
        try { localStorage.setItem(key, val); } catch(e) {
          console.error('Erro ao salvar no localStorage:', e);
          if (e instanceof DOMException && e.name === 'QuotaExceededError') {
             // Optional: Clear some cache if needed
             // localStorage.removeItem('tagmaster_translations');
          }
        }
      }
      
      fontSizePrimary.value = savedPrimary;
      fontSizeSecondary.value = savedSecondary;
      fontSizePrimaryVal.textContent = savedPrimary + 'em';
      fontSizeSecondaryVal.textContent = savedSecondary + 'em';
      
      document.documentElement.style.setProperty('--font-size-top', savedPrimary + 'em');
      document.documentElement.style.setProperty('--font-size-bottom', savedSecondary + 'em');

      fontSizePrimary.oninput = (e) => {
        const val = (e.target as HTMLInputElement).value;
        fontSizePrimaryVal.textContent = val + 'em';
        document.documentElement.style.setProperty('--font-size-top', val + 'em');
        storageSet('tagmaster_font_primary', val);
      };

      fontSizeSecondary.oninput = (e) => {
        const val = (e.target as HTMLInputElement).value;
        fontSizeSecondaryVal.textContent = val + 'em';
        document.documentElement.style.setProperty('--font-size-bottom', val + 'em');
        storageSet('tagmaster_font_secondary', val);
      };
    }

    const fontSizeInput = document.getElementById('fontSizeInput') as HTMLInputElement;
    const fontSizeInputVal = document.getElementById('fontSizeInputVal') as HTMLSpanElement;
    const fontWeightTop = document.getElementById('fontWeightTop') as HTMLSelectElement;
    const fontWeightBottom = document.getElementById('fontWeightBottom') as HTMLSelectElement;
    const fontFamilySelect = document.getElementById('fontFamilySelect') as HTMLSelectElement;

    if (fontSizeInput) {
      let savedInputSize = '0.92';
      try {
        savedInputSize = localStorage.getItem('tagmaster_font_input') || '0.92';
      } catch (e) {}
      fontSizeInput.value = savedInputSize;
      fontSizeInputVal.textContent = savedInputSize + 'em';
      document.documentElement.style.setProperty('--input-font-size', savedInputSize + 'em');

      fontSizeInput.oninput = (e) => {
        const val = (e.target as HTMLInputElement).value;
        fontSizeInputVal.textContent = val + 'em';
        document.documentElement.style.setProperty('--input-font-size', val + 'em');
        try {
          localStorage.setItem('tagmaster_font_input', val);
        } catch (e) {}
      };
    }

    if (fontWeightTop) {
      let savedWeightTop = '400';
      try {
        savedWeightTop = localStorage.getItem('tagmaster_weight_top') || '400';
      } catch (e) {}
      fontWeightTop.value = savedWeightTop;
      document.documentElement.style.setProperty('--font-weight-top', savedWeightTop);

      fontWeightTop.onchange = (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.documentElement.style.setProperty('--font-weight-top', val);
        try {
          localStorage.setItem('tagmaster_weight_top', val);
        } catch (e) {}
      };
    }

    if (fontWeightBottom) {
      let savedWeightBottom = '400';
      try {
        savedWeightBottom = localStorage.getItem('tagmaster_weight_bottom') || '400';
      } catch (e) {}
      fontWeightBottom.value = savedWeightBottom;
      document.documentElement.style.setProperty('--font-weight-bottom', savedWeightBottom);

      fontWeightBottom.onchange = (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.documentElement.style.setProperty('--font-weight-bottom', val);
        try {
          localStorage.setItem('tagmaster_weight_bottom', val);
        } catch (e) {}
      };
    }

    if (fontFamilySelect) {
      let savedFontFamily = 'var(--font-sans)';
      try {
        savedFontFamily = localStorage.getItem('tagmaster_font_family') || 'var(--font-sans)';
      } catch (e) {}
      fontFamilySelect.value = savedFontFamily;
      document.documentElement.style.setProperty('--custom-font-family', savedFontFamily);

      fontFamilySelect.onchange = (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.documentElement.style.setProperty('--custom-font-family', val);
        try {
          localStorage.setItem('tagmaster_font_family', val);
        } catch (e) {}
      };
    }

    compareBtn.onclick = () => { compareModal.style.display = 'flex'; updateDiff(); };
    compareBase.oninput = updateDiff;
    function updateDiff() {
      const base = compareBase.value.split(',').map(t => t.trim()).filter(t => t);
      const curr = input.value.split(',').map(t => t.trim()).filter(t => t);
      let h = '';
      curr.forEach(t => {
        if (base.includes(t)) h += `<span>${t}</span>, `;
        else h += `<span class="diff-added">${t}</span>, `;
      });
      base.forEach(t => {
        if (!curr.includes(t)) h += `<span class="diff-removed">${t}</span>, `;
      });
      compareDiff.innerHTML = h;
    }

    let placeholder: HTMLElement | null = null, dragClone: HTMLElement | null = null, draggedTag: HTMLElement | null = null;
    let dragOffsetX = 0, dragOffsetY = 0;
    let tagSnapshots: { el: HTMLElement, rect: DOMRect }[] = [];

    function startDrag(e: PointerEvent, tag: HTMLElement) {
      e.preventDefault();
      draggedTag = tag;
      const rect = tag.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      
      tag.style.opacity = '0.3';
      
      dragClone = tag.cloneNode(true) as HTMLElement;
      dragClone.style.cssText = `position:fixed; pointer-events:none; z-index:9999; opacity:0.9; margin:0; left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; transition:none;`;
      document.body.appendChild(dragClone);
      _snapshotPositions();
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
    }

    function _snapshotPositions() {
      tagSnapshots = [...tagsContainer.querySelectorAll('.tag')]
        .filter(t => t !== placeholder && (t as HTMLElement).style.display !== 'none')
        .map(t => ({ el: t as HTMLElement, rect: t.getBoundingClientRect() }));
    }

    let rafId: number | null = null;
    function onDragMove(e: PointerEvent) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!dragClone) return;
        dragClone.style.left = (e.clientX - dragOffsetX) + 'px';
        dragClone.style.top = (e.clientY - dragOffsetY) + 'px';
        
        let target: HTMLElement | null = null;
        let bestDist = Infinity;
        const threshold = 40; 
        
        tagSnapshots.forEach(({ el, rect }) => {
          if (el === draggedTag) return;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
          
          if (dist < bestDist - threshold) { 
            bestDist = dist; 
            target = el; 
          }
        });
        
        // Remove highlight from all tags
        tagSnapshots.forEach(({ el }) => el.classList.remove('tag-drop-target'));
        
        // Add highlight to target
        if (target) {
          (target as HTMLElement).classList.add('tag-drop-target');
        }
      });
    }

    function onDragEnd() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      
      const target = tagsContainer.querySelector('.tag-drop-target') as HTMLElement;
      if (target && draggedTag) {
        // Determine if we should insert before or after based on mouse position
        const rect = target.getBoundingClientRect();
        const insertBefore = (dragClone?.getBoundingClientRect().left || 0) < (rect.left + rect.width / 2);
        
        if (insertBefore) {
          tagsContainer.insertBefore(draggedTag, target);
        } else {
          tagsContainer.insertBefore(draggedTag, target.nextSibling);
        }
      }
      
      // Cleanup all highlights
      tagsContainer.querySelectorAll('.tag-drop-target').forEach(el => el.classList.remove('tag-drop-target'));
      
      dragClone?.remove();
      if (draggedTag) draggedTag.style.opacity = '';
      dragClone = null; draggedTag = null; tagSnapshots = [];
      updateTextarea();
      saveState();
    }

    librarySearchInput.oninput = () => {
      const term = librarySearchInput.value.toLowerCase();
      document.querySelectorAll('.library-group').forEach(group => {
        // If searching, we must render tags to check them
        if (term !== '' && (group as any)._renderTags) {
          (group as any)._renderTags();
        }

        let hasVisible = false;
        group.querySelectorAll('.lib-tag').forEach(tag => {
          const visible = tag.textContent?.toLowerCase().includes(term);
          (tag as HTMLElement).style.display = visible ? 'flex' : 'none';
          if (visible && term !== '') { tag.classList.add('highlight'); hasVisible = true; }
          else { tag.classList.remove('highlight'); if (visible) hasVisible = true; }
        });
        (group as HTMLElement).style.display = hasVisible || term === '' ? 'block' : 'none';
        
        // Auto-expand if searching and matches found
        if (term !== '' && hasVisible) {
          group.classList.remove('collapsed');
        } else if (term === '') {
          group.classList.add('collapsed');
        }
      });
    };

    // Removed importBtn.onclick from here to avoid stale closure
    // It's now handled by handleImport in the component

    exportBtn.onclick = () => {
      const data = { custom: customCategories, presets };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'tagmaster_biblioteca.json'; a.click();
    };

    window.addEventListener('keydown', (e) => {
      if (selectedTags.size === 0) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        selectedTags.forEach(t => adjustWeight(t.querySelector('input') as HTMLInputElement, e.key === 'ArrowUp' ? 0.1 : -0.1));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          selectedTags.forEach(t => { addTagToTrash((t.querySelector('input') as HTMLInputElement).value); t.remove(); });
          selectedTags.clear(); updateTextarea(); saveState();
        }
      }
    });

    function adjustWeight(inp: HTMLInputElement, delta: number) {
      let val = inp.value.trim();
      if (val.startsWith('<lora:')) {
        const match = val.match(/<lora:([^:]+):([0-9.+-]+)>/);
        if (match) { let w = Math.max(-5, Math.min(5, parseFloat(match[2]) + delta)); inp.value = `<lora:${match[1]}:${w.toFixed(1)}>`; }
      } else {
        const match = val.match(/\(([^:]+):([0-9.+-]+)\)/);
        if (match) { let w = Math.max(-5, Math.min(5, parseFloat(match[2]) + delta)); inp.value = `(${match[1]}:${w.toFixed(1)})`; }
        else { let w = Math.max(-5, Math.min(5, 1.0 + delta)); inp.value = `(${val.replace(/^\(+|\)+$/g, '')}:${w.toFixed(1)})`; }
      }
      inp.dispatchEvent(new Event('input'));
    }

    input.oninput = () => { 
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 300) + 'px';
      
      const timeoutId = (window as any).t;
      clearTimeout(timeoutId); 
      (window as any).t = setTimeout(() => {
        updateTagsFromInput(true);
        updateBackdrop();
      }, 100); // Reduzido para 100ms para parecer tempo real
    };

    input.onpaste = () => {
      // Processa imediatamente após o evento de colar
      setTimeout(() => {
        updateTagsFromInput(true);
        updateBackdrop();
      }, 10);
    };
    
    copyPromptBtn.onclick = () => {
      // Clean the prompt: remove layer tags and extra whitespace
      const cleanPrompt = input.value
        .split(/[,\n]+/)
        .map(t => t.trim())
        .filter(t => t && !(t.startsWith('[') && t.endsWith(']')))
        .join(', ');
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cleanPrompt).then(() => {
          const o = copyPromptBtn.textContent; copyPromptBtn.textContent = 'Copiado!';
          setTimeout(() => copyPromptBtn.textContent = o, 2000);
        }).catch(err => {
          console.error('Erro ao copiar:', err);
          showAlert('Erro', 'Não foi possível copiar para a área de transferência.');
        });
      } else {
        // Fallback for older browsers or insecure contexts
        try {
          const textArea = document.createElement("textarea");
          textArea.value = cleanPrompt;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
          const o = copyPromptBtn.textContent; copyPromptBtn.textContent = 'Copiado!';
          setTimeout(() => copyPromptBtn.textContent = o, 2000);
        } catch (err) {
          console.error('Erro ao copiar (fallback):', err);
          showAlert('Erro', 'Não foi possível copiar para a área de transferência.');
        }
      }
    };



    window.addEventListener('reload-library', () => loadExternalLibrary().catch(console.error));

    loadExternalLibrary().catch(console.error);
    updateTagsFromInput(false);
    updateBackdrop();
    saveState();

    return () => {
      window.removeEventListener('reload-library', loadExternalLibrary);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  useEffect(() => {
    const presetsBarVertical = document.getElementById('presetsBarVertical') as HTMLDivElement;
    const input = document.getElementById('input') as HTMLTextAreaElement;
    const promptNotes = document.getElementById('promptNotes') as HTMLTextAreaElement;

    function updatePresetsBar() {
      if (!presetsBarVertical) return;
      presetsBarVertical.innerHTML = '';

      presets.forEach((p) => {
        const container = document.createElement('div');
        container.className = `preset-item-container ${expandedPresets.has(p.id) ? 'expanded' : ''}`;
        
        const header = document.createElement('div');
        header.className = 'preset-header';

        const expandBtn = document.createElement('button');
        expandBtn.className = 'preset-expand-btn';
        expandBtn.textContent = '▼';
        expandBtn.onclick = (e) => {
          e.stopPropagation();
          const newExpanded = new Set(expandedPresets);
          if (newExpanded.has(p.id)) newExpanded.delete(p.id);
          else newExpanded.add(p.id);
          setExpandedPresets(newExpanded);
        };

        const b = document.createElement('button'); 
        b.className = 'preset-btn'; 
        b.style.flex = '1';
        
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'display: flex; align-items: center; gap: 10px; flex: 1;';

        if (p.image) {
          const img = document.createElement('img');
          img.src = p.image;
          img.className = 'preset-thumb';
          img.referrerPolicy = "no-referrer";
          contentDiv.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'preset-thumb';
          placeholder.style.display = 'flex';
          placeholder.style.alignItems = 'center';
          placeholder.style.justifyContent = 'center';
          placeholder.style.fontSize = '1.2em';
          placeholder.textContent = '🖼️';
          contentDiv.appendChild(placeholder);
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        contentDiv.appendChild(nameSpan);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        const editBtn = document.createElement('span');
        editBtn.textContent = '✏️';
        editBtn.style.cssText = 'cursor: pointer; font-size: 0.9em; opacity: 0.7;';
        editBtn.title = 'Editar prompt';
        editBtn.onclick = (e) => {
          e.stopPropagation();
          openEditPresetModal(p);
        };

        const delBtn = document.createElement('span');
        delBtn.textContent = '×';
        delBtn.style.cssText = 'color: var(--danger); font-weight: bold; padding: 0 4px; border-radius: 4px; cursor: pointer;';
        delBtn.title = 'Deletar prompt';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          showConfirm('Deletar Prompt', `Deletar prompt "${p.name}"?`, () => {
            const newPresets = presets.filter(x => x.id !== p.id);
            setPresets(newPresets);
            try {
          safeSetItem('tagmaster_presets', JSON.stringify(newPresets));
            } catch (e) {
              console.error('Erro ao salvar no localStorage:', e);
            }
          });
        };

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);

        b.onclick = () => { 
          if (input) input.value = p.prompt; 
          if (promptNotes) promptNotes.value = p.notes || ''; 
          setCurrentPromptTitle(p.name);
          setCurrentPromptThumbnail(p.image || null);
          setCurrentAdvanced({
            baseModel: p.baseModel || '',
            loras: p.loras || '',
            cfgScale: p.cfgScale || '',
            steps: p.steps || '',
            sampler: p.sampler || '',
            seed: p.seed || '',
            otherParams: p.otherParams || ''
          });
          if (p.baseModel || p.loras || p.cfgScale || p.steps || p.sampler || p.seed || p.otherParams) {
            setShowAdvanced(true);
          }
          if (input) {
            const event = new Event('input', { bubbles: true });
            input.dispatchEvent(event);
          }
        };
        
        b.appendChild(contentDiv);
        b.appendChild(actionsDiv);
        
        header.appendChild(expandBtn);
        header.appendChild(b);
        container.appendChild(header);

        // Expanded Content
        if (expandedPresets.has(p.id)) {
          const expanded = document.createElement('div');
          expanded.className = 'preset-expanded-content';
          
          const tagsPreview = document.createElement('div');
          tagsPreview.className = 'preset-tags-preview';
          
          if (p.image) {
            const img = document.createElement('img');
            img.src = p.image;
            img.style.cssText = 'width: 100%; height: auto; object-fit: contain; border-radius: 8px; margin-bottom: 12px;';
            img.referrerPolicy = "no-referrer";
            tagsPreview.appendChild(img);
          }
          
          const tags = p.prompt.split(',').map(t => t.trim()).filter(t => t);
          tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'preset-tag-chip';
            chip.textContent = tag;
            chip.onclick = () => {
              if (!input) return;
              const currentVal = input.value.trim();
              if (currentVal) {
                input.value = currentVal + (currentVal.endsWith(',') ? ' ' : ', ') + tag;
              } else {
                input.value = tag;
              }
              const event = new Event('input', { bubbles: true });
              input.dispatchEvent(event);
            };
            tagsPreview.appendChild(chip);
          });

          const actionsRow = document.createElement('div');
          actionsRow.className = 'preset-actions-row';
          
          const insertAllBtn = document.createElement('button');
          insertAllBtn.className = 'btn btn-secondary';
          insertAllBtn.style.fontSize = '0.75em';
          insertAllBtn.textContent = 'Inserir Todas';
          insertAllBtn.onclick = () => {
             if (!input) return;
             const currentVal = input.value.trim();
             if (currentVal) {
               input.value = currentVal + (currentVal.endsWith(',') ? ' ' : ', ') + p.prompt;
             } else {
               input.value = p.prompt;
             }
             const event = new Event('input', { bubbles: true });
             input.dispatchEvent(event);
          };

          actionsRow.appendChild(insertAllBtn);
          expanded.appendChild(tagsPreview);
          
          // Advanced Fields Display
          if (p.baseModel || p.loras || p.cfgScale || p.steps || p.sampler || p.seed || p.otherParams) {
            const advContainer = document.createElement('div');
            advContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color); font-size: 0.85em; color: var(--text-muted);';
            
            const advTitle = document.createElement('div');
            advTitle.textContent = '⚙️ Parâmetros Avançados';
            advTitle.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: var(--text-color);';
            advContainer.appendChild(advTitle);
            
            const grid = document.createElement('div');
            grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px;';
            
            const addField = (label: string, value?: string) => {
              if (!value) return;
              const f = document.createElement('div');
              f.innerHTML = `<strong style="color:var(--text-faint)">${label}:</strong> <span style="color:var(--text-color)">${value}</span>`;
              grid.appendChild(f);
            };
            
            addField('Modelo', p.baseModel);
            addField('LoRAs', p.loras);
            addField('CFG', p.cfgScale);
            addField('Steps', p.steps);
            addField('Sampler', p.sampler);
            addField('Seed', p.seed);
            
            advContainer.appendChild(grid);
            
            if (p.otherParams) {
              const other = document.createElement('div');
              other.style.cssText = 'margin-top: 8px;';
              other.innerHTML = `<strong style="color:var(--text-faint)">Outros:</strong> <span style="color:var(--text-color)">${p.otherParams}</span>`;
              advContainer.appendChild(other);
            }
            
            expanded.appendChild(advContainer);
          }

          expanded.appendChild(actionsRow);
          container.appendChild(expanded);
        }

        presetsBarVertical.appendChild(container);
      });
    }

    function openEditPresetModal(preset: any) {
      const modal = document.getElementById('editPresetModal');
      const titleInput = document.getElementById('editPresetTitle') as HTMLInputElement;
      const promptInput = document.getElementById('editPresetPrompt') as HTMLTextAreaElement;
      const negativePromptInput = document.getElementById('editPresetNegativePrompt') as HTMLTextAreaElement;
      const notesInput = document.getElementById('editPresetNotes') as HTMLTextAreaElement;
      const imageInput = document.getElementById('editPresetImage') as HTMLInputElement;
      const preview = document.getElementById('editPresetPreview') as HTMLImageElement;
      const saveBtn = document.getElementById('confirmEditPresetBtn') as HTMLButtonElement;
      
      const baseModelInput = document.getElementById('editPresetBaseModel') as HTMLInputElement;
      const lorasInput = document.getElementById('editPresetLoras') as HTMLInputElement;
      const cfgScaleInput = document.getElementById('editPresetCfgScale') as HTMLInputElement;
      const stepsInput = document.getElementById('editPresetSteps') as HTMLInputElement;
      const samplerInput = document.getElementById('editPresetSampler') as HTMLInputElement;
      const seedInput = document.getElementById('editPresetSeed') as HTMLInputElement;
      const otherParamsInput = document.getElementById('editPresetOtherParams') as HTMLTextAreaElement;

      if (modal && titleInput && promptInput && notesInput && imageInput && preview && saveBtn) {
        titleInput.value = preset.name;
        promptInput.value = preset.prompt;
        if (negativePromptInput) negativePromptInput.value = preset.negativePrompt || '';
        notesInput.value = preset.notes || '';
        preview.src = preset.image || '';
        preview.style.display = preset.image ? 'block' : 'none';
        imageInput.value = '';
        
        if (baseModelInput) baseModelInput.value = preset.baseModel || '';
        if (lorasInput) lorasInput.value = preset.loras || '';
        if (cfgScaleInput) cfgScaleInput.value = preset.cfgScale || '';
        if (stepsInput) stepsInput.value = preset.steps || '';
        if (samplerInput) samplerInput.value = preset.sampler || '';
        if (seedInput) seedInput.value = preset.seed || '';
        if (otherParamsInput) otherParamsInput.value = preset.otherParams || '';
        
        saveBtn.onclick = () => {
          if (!titleInput.value.trim()) {
            showAlert('Atenção', 'O título é obrigatório!');
            return;
          }
          
          const updatedPresets = presets.map(p => {
            if (p.id === preset.id) {
              return {
                ...p,
                name: titleInput.value.trim(),
                prompt: promptInput.value,
                negativePrompt: negativePromptInput ? negativePromptInput.value : p.negativePrompt,
                notes: notesInput.value,
                image: preview.src && !preview.src.startsWith('data:image/svg') ? preview.src : p.image,
                baseModel: baseModelInput ? baseModelInput.value : p.baseModel,
                loras: lorasInput ? lorasInput.value : p.loras,
                cfgScale: cfgScaleInput ? cfgScaleInput.value : p.cfgScale,
                steps: stepsInput ? stepsInput.value : p.steps,
                sampler: samplerInput ? samplerInput.value : p.sampler,
                seed: seedInput ? seedInput.value : p.seed,
                otherParams: otherParamsInput ? otherParamsInput.value : p.otherParams
              };
            }
            return p;
          });

          setPresets(updatedPresets);
          try {
          safeSetItem('tagmaster_presets', JSON.stringify(updatedPresets));
          } catch (e) {
            console.error('Erro ao salvar no localStorage:', e);
          }
          modal.style.display = 'none';
        };
        
        modal.style.display = 'flex';
      }
    }

    updatePresetsBar();
  }, [presets, expandedPresets]);

  const handleImport = async () => {
    const title = importTitleRef.current?.value.trim() || 'Tags Importadas';
    const fullTitle = `${selectedIcon} ${title}`;
    const text = importInputRef.current?.value.trim();
    if (!text) return;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const tags: string[] = [];

    lines.forEach(line => {
      if (line.startsWith('\\\\')) {
        tags.push(line);
      } else if (line.includes(':')) {
        const [key, trans] = line.split(':').map(s => s.trim());
        if (key) {
          tags.push(key);
          if (trans) {
            const cleanKey = key.toLowerCase().replace(/_/g, ' ');
            // Update both localStorage and the in-memory cache
            let cache = {};
            try {
              cache = JSON.parse(localStorage.getItem('tagmaster_translations') || '{}');
              (cache as any)[cleanKey] = trans;
              localStorage.setItem('tagmaster_translations', JSON.stringify(cache));
            } catch (e) {
              console.error('Erro ao atualizar cache de tradução:', e);
            }
            
            // Update the global translationCache object so it's available immediately
            translationCache[cleanKey] = trans;
          }
        }
      } else {
        tags.push(line);
      }
    });

    if (tags.length === 0) return;

    // Generate .txt content
    const txtContent = `${fullTitle}\n${selectedColor}\n${tags.join('\n')}`;
    
    // Create blob and download
    const blob = new Blob([txtContent], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    a.download = `custom_${safeTitle}_${new Date().getTime()}.txt`;
    a.click();

    // Try to save to server as well
    try {
      const res = await fetch('/api/library/create-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fullTitle, color: selectedColor, tags })
      });
      const data = await res.json();
      if (data.success) {
        console.log('Servidor atualizado:', data.message);
        window.dispatchEvent(new CustomEvent('reload-library'));
      }
    } catch (err) {
      console.warn('Não foi possível salvar no servidor, mas o arquivo foi baixado:', err);
    }

    showAlert('Sucesso', `Arquivo gerado com sucesso!\n\nO arquivo foi baixado e também tentamos adicioná-lo automaticamente à biblioteca.`);

    // Clear inputs and close modal
    if (importInputRef.current) importInputRef.current.value = '';
    if (importTitleRef.current) importTitleRef.current.value = '';
    setSelectedIcon('🏷️');
    setSelectedColor('#808080');
    setShowCreateCategoryModal(false);
  };

  const handleClearImport = () => {
    if (importInputRef.current) importInputRef.current.value = '';
    if (importTitleRef.current) importTitleRef.current.value = '';
    setSelectedIcon('🏷️');
    setSelectedColor('#808080');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-color)] text-[var(--text-color)] font-sans">
      <div className={`drag-overlay ${isDragging ? 'active' : ''}`}>
        <div className="drag-overlay-content">
          <h2>🖼️ Solte a imagem aqui</h2>
          <p>Ela será usada como thumbnail e você poderá extrair os metadados.</p>
        </div>
      </div>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-logo">⚡</div>
          <div className="topbar-title">
            <strong>TAGMASTER SD <span className="pro">PRO</span></strong>
            <small>Prompt Engineering Studio</small>
          </div>
          <div className="topbar-space"></div>
          <div className="controls">
            <div id="tokenCounter" className="counter-badge">Tokens: 0 / 75</div>
            <div id="charCounter" className="counter-badge">Caracteres: 0</div>
            <button id="toggleLangBtn" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8em', whiteSpace: 'nowrap' }}>🔄 Inverter</button>
            <button id="compareBtn" className="btn btn-secondary">⚖️ Comparar</button>
            <button id="settingsBtn" className="btn btn-secondary">⚙️ Configurações</button>
            <button id="exportBtn" className="btn btn-export">💾 Exportar</button>
            <button id="copyPromptBtn" className="btn btn-primary">Copiar Prompt</button>
            <button id="undoBtn" className="btn btn-secondary" disabled>↩ Desfazer</button>
            <button id="redoBtn" className="btn btn-secondary" disabled>↪ Refazer</button>
          </div>
        </div>
      </header>

      <div className="container" id="appContainer">
        <div className="main-col">
          <div className="current-prompt-header">
            <div className="current-thumbnail-box" onClick={() => document.getElementById('topThumbnailInput')?.click()}>
              {currentPromptThumbnail ? (
                <img src={currentPromptThumbnail} alt="Thumbnail" referrerPolicy="no-referrer" />
              ) : (
                <div className="placeholder">🖼️</div>
              )}
              <input 
                type="file" 
                id="topThumbnailInput" 
                hidden 
                accept="image/*" 
                onChange={async (e) => {
                  try {
                    const file = e.target.files?.[0];
                    if (file) await handleImageDrop(file);
                  } catch (err) {
                    console.error('Erro no topThumbnailInput:', err);
                  }
                }} 
              />
            </div>
            <div className="current-title-container">
              <input 
                type="text" 
                className="current-title-input" 
                placeholder="Título do Prompt..." 
                value={currentPromptTitle}
                onChange={(e) => setCurrentPromptTitle(e.target.value)}
              />
              <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>
                {currentPromptTitle ? 'Prompt Nomeado' : 'Sem Título'}
              </div>
            </div>
          </div>

          <div className="advanced-section" style={{ marginBottom: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <button 
              className="advanced-toggle" 
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 'bold', color: 'var(--text-color)' }}
            >
              <span>⚙️ Avançado</span>
              <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </button>
            
            {showAdvanced && (
              <div className="advanced-content" style={{ padding: '16px', borderTop: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>Modelo Base</label>
                  <input type="text" value={currentAdvanced.baseModel} onChange={e => setCurrentAdvanced({...currentAdvanced, baseModel: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>LoRAs</label>
                  <input type="text" value={currentAdvanced.loras} onChange={e => setCurrentAdvanced({...currentAdvanced, loras: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>CFG Scale</label>
                  <input type="text" value={currentAdvanced.cfgScale} onChange={e => setCurrentAdvanced({...currentAdvanced, cfgScale: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>Steps</label>
                  <input type="text" value={currentAdvanced.steps} onChange={e => setCurrentAdvanced({...currentAdvanced, steps: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>Sampler</label>
                  <input type="text" value={currentAdvanced.sampler} onChange={e => setCurrentAdvanced({...currentAdvanced, sampler: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field">
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>Seed</label>
                  <input type="text" value={currentAdvanced.seed} onChange={e => setCurrentAdvanced({...currentAdvanced, seed: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                </div>
                <div className="adv-field" style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '4px' }}>Outros Parâmetros</label>
                  <textarea value={currentAdvanced.otherParams} onChange={e => setCurrentAdvanced({...currentAdvanced, otherParams: e.target.value})} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', minHeight: '60px', resize: 'vertical' }} />
                </div>
              </div>
            )}
          </div>

          <h2>Prompt Principal (Positivo)</h2>
          <div className="prompt-wrapper">
            <div id="inputBackdrop" className="input-backdrop"></div>
            <textarea id="input" placeholder="Ex: score_9, 1girl, blue_eyes..."></textarea>
          </div>
          
          <h2 style={{ marginTop: '16px' }}>Prompt Negativo</h2>
          <div className="prompt-wrapper" style={{ marginBottom: '16px' }}>
            <textarea id="negativeInput" placeholder="Ex: worst quality, low quality, bad anatomy..." style={{ minHeight: '80px' }}></textarea>
          </div>

          <div className="tags-section">
            <h2>Prompt Ativo</h2>
            <div className="tags-display" id="tagsContainer"></div>
          <div className="prompt-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
              <div className="dropdown-container" style={{ position: 'relative', display: 'inline-block' }}>
                <button id="addLayerBtn" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8em' }}>📑 Adicionar Camada/Grupo ▾</button>
                <div id="groupDropdown" className="dropdown-menu" style={{ display: 'none', position: 'absolute', top: '100%', left: 0, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, minWidth: '200px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                  <div className="dropdown-item" data-group="Nova Camada" style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', fontWeight: 'bold' }}>[Nova Camada] (Em branco)</div>
                  {PREDEFINED_GROUPS.map(g => (
                    <div key={g} className="dropdown-item" data-group={g} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}>[{g}]</div>
                  ))}
                </div>
              </div>

              <button 
                id="savePresetBtn" 
                className="btn btn-success" 
                style={{ padding: '6px 12px', fontSize: '0.8em' }}
                onClick={() => {
                  if (!currentPromptTitle.trim()) {
                    showAlert('Atenção', 'Por favor, insira um título na área superior antes de salvar!');
                    return;
                  }
                  const input = document.getElementById('input') as HTMLTextAreaElement;
                  const negativeInput = document.getElementById('negativeInput') as HTMLTextAreaElement;
                  const promptNotes = document.getElementById('promptNotes') as HTMLTextAreaElement;
                  const newPreset = {
                    id: Date.now(),
                    name: currentPromptTitle.trim(),
                    prompt: input ? input.value : '',
                    negativePrompt: negativeInput ? negativeInput.value : '',
                    notes: promptNotes ? promptNotes.value : '',
                    image: currentPromptThumbnail || '',
                    baseModel: currentAdvanced.baseModel,
                    loras: currentAdvanced.loras,
                    cfgScale: currentAdvanced.cfgScale,
                    steps: currentAdvanced.steps,
                    sampler: currentAdvanced.sampler,
                    seed: currentAdvanced.seed,
                    otherParams: currentAdvanced.otherParams
                  };
                  const updatedPresets = [...presets, newPreset];
                  setPresets(updatedPresets);
                  try {
                    safeSetItem('tagmaster_presets', JSON.stringify(updatedPresets));
                  } catch (e) {
                    console.error('Erro ao salvar no localStorage:', e);
                  }
                  showAlert('Sucesso', 'Prompt salvo com sucesso!');
                }}
              >
                💾 Salvar Prompt
              </button>
              <button id="addBreakBtn" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8em', fontWeight: 'bold' }}>BREAK</button>
              <button id="addAndBtn" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8em', fontWeight: 'bold' }}>AND</button>
              <button id="selectAllBtn" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8em' }}>☑️ Selecionar Tudo</button>
              <button id="clearAllBtn" className="btn" style={{ padding: '6px 12px', fontSize: '0.8em', backgroundColor: '#e67e22', color: 'white', fontWeight: 'bold' }}>🗑️ Limpar Tudo</button>
            </div>
          </div>
          <div className="trash-section">
            <h2>Tags Removidas</h2>
            <div className="trash-tags" id="trashContainer"></div>
          </div>
          <div className="notes-section">
            <h3>📝 Notas do Prompt</h3>
            <textarea id="promptNotes" className="notes-textarea" placeholder="Anote lembretes..."></textarea>
          </div>
        </div>
      </div>

      <div id="editPresetModal" className="compare-modal" style={{ display: 'none' }}>
        <div className="compare-content" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
          <h2>✏️ Editar Prompt</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.85em', color: 'var(--text-faint)' }}>Título</label>
              <input type="text" id="editPresetTitle" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.85em', color: 'var(--text-faint)' }}>Prompt</label>
              <textarea id="editPresetPrompt" className="notes-textarea" style={{ minHeight: '80px' }}></textarea>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.85em', color: 'var(--text-faint)' }}>Prompt Negativo</label>
              <textarea id="editPresetNegativePrompt" className="notes-textarea" style={{ minHeight: '60px' }}></textarea>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.85em', color: 'var(--text-faint)' }}>Notas</label>
              <textarea id="editPresetNotes" className="notes-textarea" style={{ minHeight: '50px' }}></textarea>
            </div>
            
            <div style={{ borderTop: '1px solid var(--border-color)', margin: '8px 0', paddingTop: '8px' }}>
              <h3 style={{ fontSize: '0.9em', marginBottom: '8px' }}>⚙️ Avançado</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>Modelo Base</label>
                  <input type="text" id="editPresetBaseModel" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>LoRAs</label>
                  <input type="text" id="editPresetLoras" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>CFG Scale</label>
                  <input type="text" id="editPresetCfgScale" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>Steps</label>
                  <input type="text" id="editPresetSteps" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>Sampler</label>
                  <input type="text" id="editPresetSampler" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>Seed</label>
                  <input type="text" id="editPresetSeed" className="btn btn-secondary" style={{ textAlign: 'left', width: '100%', padding: '4px 8px', fontSize: '0.85em' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.75em', color: 'var(--text-faint)' }}>Outros Parâmetros</label>
                  <textarea id="editPresetOtherParams" className="notes-textarea" style={{ minHeight: '40px', padding: '4px 8px', fontSize: '0.85em' }}></textarea>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.85em', color: 'var(--text-faint)' }}>Alterar Imagem</label>
              <input type="file" id="editPresetImage" accept="image/*" style={{ fontSize: '0.8em' }} />
              <img id="editPresetPreview" style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '8px', marginTop: '8px', display: 'none', background: 'var(--bg-color)' }} referrerPolicy="no-referrer" />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button id="cancelEditPresetBtn" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancelar</button>
              <button id="confirmEditPresetBtn" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Salvar Alterações</button>
            </div>
          </div>
        </div>
      </div>
      <div id="settingsModal" className="modal-overlay" style={{ display: 'none' }}>
        <div className="modal-content" style={{ maxWidth: '400px', maxHeight: '90vh', overflowY: 'auto' }}>
          <h2>⚙️ Configurações</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', marginBottom: '24px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', color: 'var(--text-faint)' }}>
                <span>Tamanho da Fonte (Superior)</span>
                <span id="fontSizePrimaryVal">1.0em</span>
              </label>
              <input type="range" id="fontSizePrimary" min="0.6" max="1.5" step="0.05" defaultValue="1" style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', color: 'var(--text-faint)' }}>
                <span>Tamanho da Fonte (Inferior)</span>
                <span id="fontSizeSecondaryVal">0.7em</span>
              </label>
              <input type="range" id="fontSizeSecondary" min="0.4" max="1.2" step="0.05" defaultValue="0.7" style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', color: 'var(--text-faint)' }}>
                <span>Tamanho da Fonte (Campo de Texto)</span>
                <span id="fontSizeInputVal">0.92em</span>
              </label>
              <input type="range" id="fontSizeInput" min="0.6" max="2.0" step="0.05" defaultValue="0.92" style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.9em', color: 'var(--text-faint)' }}>Peso da Fonte (Superior)</label>
              <select id="fontWeightTop" className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }}>
                <option value="400">Normal</option>
                <option value="600">Semi-bold</option>
                <option value="700">Bold</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.9em', color: 'var(--text-faint)' }}>Peso da Fonte (Inferior)</label>
              <select id="fontWeightBottom" className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }}>
                <option value="400">Normal</option>
                <option value="600">Semi-bold</option>
                <option value="700">Bold</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.9em', color: 'var(--text-faint)' }}>Fonte (Tags e Texto)</label>
              <select id="fontFamilySelect" className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }}>
                <option value="var(--font-sans)">Padrão (Sans)</option>
                <option value="monospace">Monospace</option>
                <option value="serif">Serif</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Courier New', Courier, monospace">Courier New</option>
              </select>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '8px 0' }} />

            <button id="darkModeBtn" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>🌙 Alternar Modo Noturno</button>
          </div>
          
          <button onClick={() => {
            const modal = document.getElementById('settingsModal');
            if (modal) modal.style.display = 'none';
          }} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Fechar</button>
        </div>
      </div>

      <button id="fabLibrary" className="fab-library" title="Abrir Biblioteca" onClick={() => {
        const modal = document.getElementById('libraryModal');
        if (modal) modal.classList.add('active');
      }}>
        📚
      </button>

      <button id="fabGuide" className="fab-guide" title="Guia de Construção" onClick={() => {
        const modal = document.getElementById('guideModal');
        if (modal) modal.classList.add('active');
      }}>
        📖
      </button>

      <div id="guideModal" className="guide-modal">
        <div className="guide-modal-content">
          <button className="close-modal-btn" onClick={() => {
            const modal = document.getElementById('guideModal');
            if (modal) modal.classList.remove('active');
          }}>×</button>
          
          <div className="sidebar-content" style={{ padding: '0 10px' }}>
            <div className="flex items-center gap-2 mb-4">
              <h2>Guia de Construção de Prompt</h2>
            </div>
            
            <div id="guideContent" className="guide-content">
              <div className="guide-content-wrapper">
                {/* HERO */}
                <div className="hero">
                  <div className="hero-badge">// GUIA AVANÇADO v2.0 //</div>
                  <h1>Manual de Prompts</h1>
                  <div className="hero-sub">Estrutura em Cascata</div>
                  <div className="hero-tags">
                    <div className="hero-tag">PONY DIFFUSION</div>
                    <div className="hero-tag">ILLUSTRIOUS</div>
                    <div className="hero-tag">GENÉRICO</div>
                    <div className="hero-tag">COM LORAS</div>
                  </div>
                </div>

                {/* NAV */}
                <nav className="toc">
                  <a href="#p1">01 Fundamentos</a>
                  <a href="#p2">02 Tags</a>
                  <a href="#p3">03 BREAK</a>
                  <a href="#p4">04 Personagens</a>
                  <a href="#p5">05 Ambiente</a>
                  <a href="#p6">06 Cascata</a>
                  <a href="#p7">07 Negativo</a>
                  <a href="#p8">08 Referência</a>
                  <a href="#p9">09 LoRAs</a>
                </nav>

                <div className="container">
                  {/* ═══════════ PARTE 1 ═══════════ */}
                  <section className="parte" id="p1">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 01</div>
                      <h2 className="parte-title">Fundamentos e <span>Lógica do Prompt</span></h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">1.1 — O que é um Prompt e como a IA o lê</h3>
                    <p className="prose">Um prompt é uma <strong>lista de instruções textuais</strong> que o modelo de difusão usa para gerar a imagem. Diferente de um texto comum, ele não tem gramática — é uma <strong>sequência de tokens com pesos</strong>. O modelo lê tudo ao mesmo tempo, mas a <strong>ordem importa</strong>: tokens no início têm mais influência.</p>

                    <div className="rule-box gold">
                      <div className="rule-label">⚡ Regra Fundamental</div>
                      A IA constrói a imagem de <strong>dentro para fora</strong> — da identidade para os detalhes, dos personagens para o ambiente.
                    </div>

                    <h3 className="sec-title">1.2 — Tokens e Limite de Contexto</h3>
                    <p className="prose">Cada palavra, pontuação ou fragmento vira um token. Modelos baseados em CLIP têm limite de <strong>75 tokens por chunk</strong>. Ultrapassar esse limite sem tratamento faz os tokens extras serem ignorados ou distorcidos.</p>

                    <div className="rule-box cyan">
                      <div className="rule-label">💡 Importante</div>
                      Use <strong>BREAK</strong> para criar novo chunk quando o prompt for longo. Cada BREAK abre um novo contexto de 75 tokens.
                    </div>

                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Tipo</th><th>Tokens</th><th>Exemplo</th></tr></thead>
                        <tbody>
                          <tr><td>Token simples</td><td>~1 token</td><td><code>1girl</code></td></tr>
                          <tr><td>Token composto</td><td>~2 tokens</td><td><code>blue_hair</code></td></tr>
                          <tr><td>Frase</td><td>3–4 tokens</td><td><code>wearing a dress</code></td></tr>
                          <tr><td>Com peso</td><td>~5 tokens</td><td><code>(laughing:1.3)</code></td></tr>
                        </tbody>
                      </table>
                    </div>

                    <h3 className="sec-title">1.3 — Pesos — Sintaxe e Lógica</h3>
                    <p className="prose">Pesos aumentam ou reduzem a atenção do modelo a um conceito. Sem peso, cada tag tem valor neutro de <strong>1.0</strong>.</p>

                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Sintaxe</th><th>Efeito</th><th>Quando usar</th></tr></thead>
                        <tbody>
                          <tr><td><code>(tag:1.3)</code></td><td>Aumenta atenção em 30%</td><td>Detalhe crítico que não pode sumir</td></tr>
                          <tr><td><code>(tag:0.7)</code></td><td>Reduz atenção em 30%</td><td>Tag presente mas não dominante</td></tr>
                          <tr><td><code>((tag))</code></td><td>Equivale a ~1.1x</td><td>Uso genérico, menos preciso</td></tr>
                          <tr><td><code>[tag]</code></td><td>Reduz atenção ~0.9x</td><td>Tag que pode ser ignorada</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="rule-box red">
                      <div className="rule-label">⚠️ Aviso</div>
                      Nunca ultrapasse <code>(tag:1.5)</code> em prompts comuns. Valores acima de 1.5 causam distorção visual, artefatos e queima de detalhes.
                    </div>

                    <div className="err-table">
                      <div className="err-header wrong">❌ Errado</div>
                      <div className="err-header right">✅ Correto</div>
                      <div className="err-row">
                        <div className="err-cell wrong"><code>(blue hair:2.0)</code> → distorce a cor toda</div>
                        <div className="err-cell right"><code>(blue hair:1.3)</code> → eleva sem distorcer</div>
                      </div>
                      <div className="err-row">
                        <div className="err-cell wrong"><code>((((1girl))))</code> → sintaxe instável</div>
                        <div className="err-cell right"><code>(1girl:1.2)</code> → equivalente, mais limpo</div>
                      </div>
                      <div className="err-row">
                        <div className="err-cell wrong"><code>(smile:1.0)</code> → peso neutro, inútil</div>
                        <div className="err-cell right"><code>smile</code> → sem peso, mesmo resultado</div>
                      </div>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 2 ═══════════ */}
                  <section className="parte" id="p2">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 02</div>
                      <h2 className="parte-title">Tags Essenciais e <span>suas Categorias</span></h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">2.1 — Setup Técnico — A Base Obrigatória</h3>
                    <p className="prose"><strong>Tags de Score</strong> — instruem o modelo a usar pesos associados a imagens de alta pontuação:</p>

                    <div className="score-chain">
                      <div className="score-pill sp-9">score_9</div>
                      <div className="score-pill sp-8">score_8_up</div>
                      <div className="score-pill sp-7">score_7_up</div>
                      <div className="score-pill sp-6">score_6_up</div>
                    </div>

                    <div className="rule-box">
                      <div className="rule-label">💡 Dica</div>
                      Use sempre a cadeia <code>score_9, score_8_up, score_7_up</code> juntas. Isso instrui o modelo a buscar qualidade máxima em cascata.
                    </div>

                    <p className="prose"><strong>Tags de Source</strong> — definem de qual dataset o modelo busca o estilo visual:</p>

                    <div className="source-grid">
                      <div className="source-card">
                        <div className="sc-icon">🎌</div>
                        <div className="sc-tag">source_anime</div>
                        <div className="sc-desc">Anime 2D clássico</div>
                      </div>
                      <div className="source-card">
                        <div className="sc-icon">🎬</div>
                        <div className="sc-tag">source_cartoon</div>
                        <div className="sc-desc">Cartoon ocidental</div>
                      </div>
                      <div className="source-card">
                        <div className="sc-icon">🐾</div>
                        <div className="sc-tag">source_furry</div>
                        <div className="sc-desc">Arte furry / antropomorfo</div>
                      </div>
                      <div className="source-card">
                        <div className="sc-icon">📷</div>
                        <div className="sc-tag">source_realistic</div>
                        <div className="sc-desc">Semi-realista / foto</div>
                      </div>
                    </div>

                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Tag de Rating</th><th>Nível</th><th>Descrição</th></tr></thead>
                        <tbody>
                          <tr><td><code>rating_safe</code></td><td>SFW total</td><td>Sem nudez ou conteúdo sensível</td></tr>
                          <tr><td><code>rating_questionable</code></td><td>Sensível</td><td>Conteúdo sugestivo, sem nudez explícita</td></tr>
                          <tr><td><code>rating_explicit</code></td><td>NSFW</td><td>Conteúdo adulto explícito</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <h3 className="sec-title">2.2 — Tags de Cena Geral — O Palco</h3>
                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Tag</th><th>Enquadramento</th><th>Uso típico</th></tr></thead>
                        <tbody>
                          <tr><td><code>full body</code></td><td>Corpo inteiro</td><td>Mostrar roupa e postura completa</td></tr>
                          <tr><td><code>upper body</code></td><td>Busto para cima</td><td>Foco em rosto e torso</td></tr>
                          <tr><td><code>close-up</code></td><td>Rosto em primeiro plano</td><td>Expressões e detalhes faciais</td></tr>
                          <tr><td><code>dynamic angle</code></td><td>Ângulo dramático livre</td><td>Cenas de ação</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 3 ═══════════ */}
                  <section className="parte" id="p3">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 03</div>
                      <h2 className="parte-title">O <span>BREAK</span> — A Tag Mais Importante</h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">3.1 — O que é o BREAK e por que ele existe</h3>
                    <p className="prose">BREAK é uma <strong>instrução especial de separação de contexto</strong>. Ela encerra o chunk atual de tokens e abre um novo, com atenção zerada. Sem ele, as tags de um personagem <strong>vazam</strong> para o outro, causando mistura de cabelos, roupas e atributos físicos.</p>

                    <div className="rule-box gold">
                      <div className="rule-label">🥇 Regra de Ouro</div>
                      Sempre coloque BREAK antes de iniciar a descrição de cada personagem individual e antes do cenário.
                    </div>

                    <div className="break-demo">
                      <div className="bd-block">
                        <div className="bd-label">📌 Chunk 1 — Setup Técnico + Cena Geral</div>
                        <div className="bd-content">score_9, score_8_up, score_7_up, source_anime, rating_safe, best quality, highres, 1boy, 1girl, sitting together</div>
                      </div>
                      <div className="bd-break">BREAK</div>
                      <div className="bd-block">
                        <div className="bd-label">👩 Chunk 2 — Personagem A</div>
                        <div className="bd-content">(1girl:1.2), pink hair, green eyes, (laughing:1.3), wearing black tank top</div>
                      </div>
                      <div className="bd-break">BREAK</div>
                      <div className="bd-block">
                        <div className="bd-label">👨 Chunk 3 — Personagem B</div>
                        <div className="bd-content">(1boy:1.2), blue hair, blue eyes, (focused:1.4), wearing white shirt</div>
                      </div>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 4 ═══════════ */}
                  <section className="parte" id="p4">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 04</div>
                      <h2 className="parte-title">Descrição de <span>Personagens</span></h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">4.1 — Ordem Interna (Macro → Micro)</h3>
                    <div className="cascade-map">
                      <div className="cascade-step">
                        <div className="cascade-num">1°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Peso / Foco</div>
                          <div className="cs-tags">(1girl:1.2) ou (1boy:1.1)</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">2°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Físico — Cabelo</div>
                          <div className="cs-tags">long pink hair, side ponytail</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">3°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Físico — Olhos</div>
                          <div className="cs-tags">green eyes, heterochromia</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">4°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Físico — Corpo</div>
                          <div className="cs-tags">petite, large breasts, tattoo on arm</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">5°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Expressão Facial</div>
                          <div className="cs-tags">(laughing:1.3), blush, happy</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">6°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Pose / Gesto</div>
                          <div className="cs-tags">arms crossed, hand on hip</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">7°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Vestimenta</div>
                          <div className="cs-tags">wearing black tank top, jeans, sneakers</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">8°</div>
                        <div className="cascade-content">
                          <div className="cs-name">Acessórios</div>
                          <div className="cs-tags">earrings, choker, glasses</div>
                        </div>
                      </div>
                    </div>

                    <h3 className="sec-title">4.3 — Tags de Expressão e Emoção</h3>
                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Expressão</th><th>Tag recomendada</th><th>Intensidade</th></tr></thead>
                        <tbody>
                          <tr><td>Sorriso neutro</td><td><code>smile</code></td><td>Sem peso</td></tr>
                          <tr><td>Riso aberto</td><td><code>(laughing:1.3)</code></td><td>Com peso</td></tr>
                          <tr><td>Raiva</td><td><code>(angry:1.2), furrowed brows</code></td><td>Com peso</td></tr>
                          <tr><td>Tristeza</td><td><code>(sad:1.1), teary eyes</code></td><td>Moderado</td></tr>
                          <tr><td>Surpresa</td><td><code>(surprised:1.3), wide eyes</code></td><td>Com peso</td></tr>
                          <tr><td>Timidez</td><td><code>blush, (embarrassed:1.1)</code></td><td>Moderado</td></tr>
                          <tr><td>Seriedade</td><td><code>(serious:1.2), expressionless</code></td><td>Com peso</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 5 ═══════════ */}
                  <section className="parte" id="p5">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 05</div>
                      <h2 className="parte-title">Ambiente, <span>Iluminação</span> e Estilo Visual</h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">5.2 — Iluminação</h3>
                    <div className="info-grid">
                      <div className="info-panel">
                        <div className="info-panel-header">🎭 dramatic lighting</div>
                        <div className="info-panel-body">
                          <p className="prose">Sombras fortes e contraste alto. Ideal para <strong>cenas de tensão ou ação</strong>.</p>
                        </div>
                      </div>
                      <div className="info-panel">
                        <div className="info-panel-header">🌸 soft lighting</div>
                        <div className="info-panel-body">
                          <p className="prose">Luz difusa, sem sombras duras. Perfeito para <strong>cenas românticas ou calmas</strong>.</p>
                        </div>
                      </div>
                      <div className="info-panel">
                        <div className="info-panel-header">✨ rim lighting</div>
                        <div className="info-panel-body">
                          <p className="prose">Contorno luminoso nas bordas. <strong>Destaca a silhueta</strong> do personagem.</p>
                        </div>
                      </div>
                      <div className="info-panel">
                        <div className="info-panel-header">🌆 golden hour</div>
                        <div className="info-panel-body">
                          <p className="prose">Luz quente de pôr do sol. Para <strong>cenas externas emotivas</strong>.</p>
                        </div>
                      </div>
                      <div className="info-panel">
                        <div className="info-panel-header">🌃 neon lighting</div>
                        <div className="info-panel-body">
                          <p className="prose">Luz colorida de neon. Ideal para <strong>ambientes urbanos noturnos</strong>.</p>
                        </div>
                      </div>
                      <div className="info-panel">
                        <div className="info-panel-header">☀️ natural lighting</div>
                        <div className="info-panel-body">
                          <p className="prose">Luz do dia, realista. Para <strong>cenas externas diurnas</strong>.</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 6 ═══════════ */}
                  <section className="parte" id="p6">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 06</div>
                      <h2 className="parte-title">A Estrutura em <span>Cascata Completa</span></h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">6.1 — Mapa Visual da Cascata</h3>
                    <div className="cascade-map">
                      <div className="cascade-step" style={{ background: 'rgba(124,58,237,0.06)' }}>
                        <div className="cascade-num" style={{ color: 'var(--g-accent2)' }}>1</div>
                        <div className="cascade-content">
                          <div className="cs-name" style={{ color: 'var(--g-accent3)' }}>Setup Técnico</div>
                          <div className="cs-tags">score_9, score_8_up, score_7_up, source_anime, rating_safe, best quality, highres</div>
                        </div>
                      </div>
                      <div className="cascade-step">
                        <div className="cascade-num">2</div>
                        <div className="cascade-content">
                          <div className="cs-name">Cena Geral</div>
                          <div className="cs-tags">1boy, 1girl, ação principal, enquadramento</div>
                        </div>
                      </div>
                      <div className="cascade-break">BREAK</div>
                      <div className="cascade-step">
                        <div className="cascade-num">3</div>
                        <div className="cascade-content">
                          <div className="cs-name">Personagem A</div>
                          <div className="cs-tags">peso › físico › expressão › roupa</div>
                        </div>
                      </div>
                      <div className="cascade-break">BREAK</div>
                      <div className="cascade-step">
                        <div className="cascade-num">4</div>
                        <div className="cascade-content">
                          <div className="cs-name">Personagem B</div>
                          <div className="cs-tags">peso › físico › expressão › roupa</div>
                        </div>
                      </div>
                      <div className="cascade-break">BREAK</div>
                      <div className="cascade-step">
                        <div className="cascade-num">5</div>
                        <div className="cascade-content">
                          <div className="cs-name">Cenário</div>
                          <div className="cs-tags">background, ambiente, localização</div>
                        </div>
                      </div>
                      <div className="cascade-step" style={{ borderBottom: 'none' }}>
                        <div className="cascade-num">6</div>
                        <div className="cascade-content">
                          <div className="cs-name">Estilo Visual e Iluminação</div>
                          <div className="cs-tags">lighting, lineart, cinematic shot</div>
                        </div>
                      </div>
                    </div>

                    <h3 className="sec-title">6.2 — Variações da Cascata por Caso</h3>
                    <div className="code-block">
                      <div className="code-label">CASO 1 — PERSONAGEM ÚNICO</div>
                      <span className="kw">score_9, score_8_up, score_7_up,</span> <span className="tag">source_anime, rating_safe,</span><br />
                      <span className="tag">best quality, highres,</span> <span className="val">1girl, solo, standing, looking at viewer,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="val">(1girl:1.2), long red hair, blue eyes, (smiling:1.2),</span><br />
                      <span className="val">wearing white dress, barefoot,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="tag">beach background, sunset, dramatic lighting, clean lineart</span>
                    </div>

                    <div className="code-block">
                      <div className="code-label">CASO 2 — DOIS PERSONAGENS</div>
                      <span className="kw">score_9, score_8_up, score_7_up,</span> <span className="tag">source_anime, rating_safe,</span><br />
                      <span className="tag">best quality, highres,</span> <span className="val">1boy, 1girl, sitting together, talking, dynamic angle,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="val">(1girl:1.2), pink hair, green eyes, (laughing:1.3), happy, blush,</span><br />
                      <span className="val">wearing a black tank top,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="val">(1boy:1.2), tall, blue hair, blue eyes, (focused:1.4),</span><br />
                      <span className="val">serious expression, wearing white shirt,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="val">tattoo parlor background, neon signs, indoor,</span><br />
                      <span className="tag">dramatic lighting, sharp focus, cinematic shot, clean lineart</span>
                    </div>

                    <div className="code-block">
                      <div className="code-label">CASO 4 — ILLUSTRIOUS</div>
                      <span className="kw">masterpiece, best quality, ultra detailed, highres,</span> <span className="val">1girl, solo,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="val">(1girl:1.2), silver hair, purple eyes, (elegant:1.2),</span><br />
                      <span className="val">wearing ballgown, standing in ballroom,</span><br />
                      <span className="brk">BREAK,</span><br />
                      <span className="tag">grand ballroom background, chandeliers, golden hour,</span><br />
                      <span className="tag">painterly, detailed lineart, soft lighting</span>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 7 ═══════════ */}
                  <section className="parte" id="p7">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 07</div>
                      <h2 className="parte-title"><span>Negative</span> Prompt</h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">7.1 — Como funciona</h3>
                    <p className="prose">O negative prompt instrui o modelo sobre o que <strong>não</strong> gerar. Funciona pelo mesmo mecanismo de atenção do prompt positivo, mas com sinal invertido.</p>

                    <div className="rule-box">
                      <div className="rule-label">📌 Regra</div>
                      O negative prompt <strong>NÃO precisa de BREAK</strong>. Ele é um contexto separado que não interage com os personagens diretamente.
                    </div>

                    <h3 className="sec-title">7.2 — Negative Prompt Base Recomendado</h3>
                    <div className="neg-code">
                      worst quality, low quality, bad quality, score_1, score_2,<br />
                      score_3, score_4, normal quality, jpeg artifacts, blurry,<br />
                      out of focus, ugly, bad anatomy, bad hands, extra fingers,<br />
                      missing fingers, deformed, mutated, extra limbs, text, watermark,<br />
                      signature, username, artist name, error, cropped
                    </div>

                    <h3 className="sec-title">7.3 — Adições Situacionais</h3>
                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Situação</th><th>Tags para adicionar</th><th>Motivo</th></tr></thead>
                        <tbody>
                          <tr><td>Cena com 2+ personagens</td><td><code>extra person, duplicate</code></td><td>Evita personagem fantasma</td></tr>
                          <tr><td>Roupa específica</td><td><code>nude, naked</code></td><td>Evita nudez indesejada</td></tr>
                          <tr><td>Fundo limpo</td><td><code>complex background</code></td><td>Mantém fundo simples</td></tr>
                          <tr><td>Arte limpa</td><td><code>sketch, rough sketch</code></td><td>Força renderização completa</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 8 ═══════════ */}
                  <section className="parte" id="p8">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 08</div>
                      <h2 className="parte-title"><span>Referência</span> Rápida</h2>
                      <div className="parte-line"></div>
                    </div>

                    <h3 className="sec-title">8.1 — Checklist antes de gerar</h3>
                    <div className="checklist">
                      <div className="check-item"><div className="check-icon"></div>Setup técnico presente? (score / source / rating / quality)</div>
                      <div className="check-item"><div className="check-icon"></div>Quantidade de personagens declarada na Cena Geral?</div>
                      <div className="check-item"><div className="check-icon"></div>BREAK antes de CADA personagem individual?</div>
                      <div className="check-item"><div className="check-icon"></div>BREAK antes do cenário?</div>
                      <div className="check-item"><div className="check-icon"></div>Expressões importantes com peso (:1.2 ou superior)?</div>
                      <div className="check-item"><div className="check-icon"></div>Nenhum peso acima de 1.5?</div>
                      <div className="check-item"><div className="check-icon"></div>Negative prompt preenchido?</div>
                      <div className="check-item"><div className="check-icon"></div>Rating compatível com o conteúdo?</div>
                    </div>

                    <h3 className="sec-title">8.3 — Erros Fatais</h3>
                    <div className="tbl-wrap">
                      <table>
                        <thead><tr><th>Erro</th><th>⚡ Consequência</th></tr></thead>
                        <tbody>
                          <tr><td>Sem BREAK entre personagens</td><td>Atributos se misturam entre personagens</td></tr>
                          <tr><td>Peso acima de 1.5</td><td>Distorção visual, artefatos, queima de cor</td></tr>
                          <tr><td>Cenário antes dos personagens</td><td>IA gasta tokens no fundo, personagens perdem qualidade</td></tr>
                          <tr><td>Negative prompt vazio</td><td>Anatomia defeituosa, artefatos, textos indesejados</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* ═══════════ PARTE 9 ═══════════ */}
                  <section className="parte" id="p9">
                    <div className="parte-header">
                      <div className="parte-num">PARTE 09</div>
                      <h2 className="parte-title">LoRAs — <span>Low-Rank Adaptation</span></h2>
                      <div className="parte-line"></div>
                    </div>

                    <div className="lora-syntax">
                      <span className="lora-bracket">&lt;</span>
                      <span className="lora-part lora-key">lora</span>
                      <span className="lora-colon">:</span>
                      <span className="lora-part lora-name">nome_do_arquivo</span>
                      <span className="lora-colon">:</span>
                      <span className="lora-part lora-weight">0.8</span>
                      <span className="lora-bracket">&gt;</span>
                    </div>

                    <div className="weight-grid">
                      <div className="weight-card">
                        <div className="wc-val">0.4</div>
                        <div className="wc-label">Influência sutil</div>
                      </div>
                      <div className="weight-card">
                        <div className="wc-val">0.7</div>
                        <div className="wc-label">Influência moderada</div>
                      </div>
                      <div className="weight-card">
                        <div className="wc-val">1.0</div>
                        <div className="wc-label">Peso máximo</div>
                      </div>
                    </div>
                  </section>

                  <footer>
                    <span>Manual de Criação de Prompts</span> — Estrutura em Cascata • Pony Diffusion &amp; Illustrious
                  </footer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="libraryModal" className="library-modal">
        <div className="library-modal-content">
          <button className="close-modal-btn" onClick={() => {
            const modal = document.getElementById('libraryModal');
            if (modal) modal.classList.remove('active');
          }}>×</button>
          
          <div className="sidebar-content" style={{ padding: 0 }}>
            <div className="flex flex-col gap-2 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2>Biblioteca</h2>
                  <div id="libTagCounter" className="counter-badge" style={{ fontSize: '0.7em', padding: '2px 6px', background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>0 tags</div>
                </div>
                <div className="flex gap-1" style={{ marginRight: '32px' }}>
                  <button id="reloadLibBtn" className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8em' }} title="Recarregar do arquivo JSON">🔄</button>
                  <button id="addCatBtn" className="btn btn-success" style={{ padding: '5px 15px', fontSize: '0.8em' }}>➕</button>
                </div>
              </div>
              <div className="library-tabs">
                <button id="tabTagsBtn" className="library-tab-btn active">Tags</button>
                <button id="tabPromptsBtn" className="library-tab-btn">Prompts Salvos</button>
                <button id="tabCardsBtn" className="library-tab-btn">Build Cards</button>
              </div>
            </div>
            
            <div id="tabTagsContent" className="library-tab-content active">
              <div className="library-search-wrap">
                <span className="search-icon">🔍</span>
                <input type="text" id="librarySearchInput" placeholder="Buscar tags em toda a biblioteca..." />
              </div>
              <div id="libraryGroupsContainer"></div>
            </div>

            <div id="tabPromptsContent" className="library-tab-content">
              <div id="presetsBarVertical" className="presets-grid"></div>
            </div>

            <div id="tabCardsContent" className="library-tab-content">
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Em breve: Build Cards (Templates)
              </div>
            </div>
          </div>

          <div id="librarySelectionBar" style={{ display: 'none', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
            <span id="librarySelectionCount" style={{ fontWeight: 'bold', color: 'var(--accent)' }}>0 selecionadas</span>
            <button id="addSelectedTagsBtn" className="btn btn-primary">Adicionar ao Prompt</button>
          </div>
        </div>
      </div>

      <div id="compareModal" className="modal-overlay" style={{ display: 'none' }}>
        <div className="modal-content">
          <h2>⚖️ Comparador</h2>
          <div className="compare-grid">
            <div>
              <h4>Base</h4>
              <textarea id="compareBase" style={{ width: '100%', height: '100px' }}></textarea>
            </div>
            <div>
              <h4>Diferenças (verde = adicionado, vermelho = removido)</h4>
              <div id="compareDiff" className="compare-diff"></div>
            </div>
          </div>
          <button onClick={() => {
            const modal = document.getElementById('compareModal');
            if (modal) modal.style.display = 'none';
          }} className="btn btn-primary">Fechar</button>
        </div>
      </div>

      {showCreateCategoryModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 style={{ margin: 0 }}>➕ Criar Nova Categoria</h2>
              <button className="close-modal-btn" onClick={() => setShowCreateCategoryModal(false)} style={{ position: 'static' }}>×</button>
            </div>
            
            <div className="import-row" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="import-field icon-field">
                <label className="import-label">Ícone</label>
                <div className="icon-picker" style={{ maxHeight: '100px', overflowY: 'auto', padding: '8px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  {icons.map(icon => (
                    <div 
                      key={icon} 
                      className={`icon-option ${icon === selectedIcon ? 'selected' : ''}`} 
                      onClick={() => setSelectedIcon(icon)}
                    >
                      {icon}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="import-field title-field">
                <label className="import-label">Título da Categoria</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="text" ref={importTitleRef} className="import-input" placeholder="Ex: Minhas Tags" style={{ flex: 1 }} />
                  <input type="color" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)} style={{ width: '40px', height: '40px', padding: '0', border: 'none', borderRadius: '4px', cursor: 'pointer' }} title="Cor da Categoria" />
                </div>
              </div>
              
              <div className="import-field tags-field">
                <label className="import-label">Lista de Tags (uma por linha)</label>
                <textarea ref={importInputRef} className="import-input" style={{ height: '200px' }} placeholder="Ex: masterpiece&#10;best quality&#10;tag_custom: Tradução Opcional"></textarea>
              </div>
              
              <div className="import-btn-wrap" style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button className="btn btn-import" onClick={handleImport} style={{ flex: 1 }}>✨ Criar e Baixar (.txt)</button>
                <button className="btn btn-clear" onClick={handleClearImport} style={{ backgroundColor: '#666' }}>🧹 Limpar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmModal.show && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h2>{confirmModal.title}</h2>
            <p style={{ margin: '16px 0', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{confirmModal.message}</p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmModal({ ...confirmModal, show: false })}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => {
                confirmModal.onConfirm();
                setConfirmModal({ ...confirmModal, show: false });
              }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {alertModal.show && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h2>{alertModal.title}</h2>
            <p style={{ margin: '16px 0', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{alertModal.message}</p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setAlertModal({ ...alertModal, show: false })}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
