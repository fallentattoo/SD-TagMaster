import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  function syncLibrary() {
    const publicDir = path.resolve(process.cwd(), "public");
    const indexPath = path.join(publicDir, "library_index.json");
    
    if (!fs.existsSync(publicDir)) return { success: false, message: "Diretório public não encontrado." };
    
    interface LibraryIndexItem {
      file: string;
      name: string;
      color: string;
      enabled?: boolean;
    }

    let index: LibraryIndexItem[] = [];
    let updated = false;
    let addedFiles = [];
    
    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          // Migração: se for array de strings, converte para array de objetos
          if (parsed.length > 0 && typeof parsed[0] === 'string') {
            console.log("[SYNC] Migrando library_index.json de strings para objetos...");
            updated = true;
            index = (parsed as string[]).map(file => {
              const filePath = path.join(publicDir, file);
              let name = file.replace('.txt', '').replace(/-/g, ' ');
              let color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
              
              if (fs.existsSync(filePath)) {
                const txtContent = fs.readFileSync(filePath, 'utf-8');
                const lines = txtContent.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length >= 2 && /^#[0-9A-Fa-f]{6}$/i.test(lines[1])) {
                  name = lines[0];
                  color = lines[1];
                  // Limpa o arquivo .txt removendo o cabeçalho
                  const cleanContent = lines.slice(2).join('\n');
                  fs.writeFileSync(filePath, cleanContent, 'utf-8');
                }
              }
              return { file, name, color, enabled: true };
            });
          } else {
            index = parsed;
          }
        }
      } catch (e) {
        index = [];
      }
    }
    
    for (const item of index) {
      if (item.enabled === undefined) {
        item.enabled = false;
        updated = true;
      }
    }

    const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.txt'));
    
    // Remove arquivos que não existem mais no disco
    const newIndex = index.filter(item => {
      if (fs.existsSync(path.join(publicDir, item.file))) {
        return true;
      }
      updated = true;
      return false;
    });
    index = newIndex;

    for (const file of files) {
      if (!index.find(item => item.file === file)) {
        console.log(`[SYNC] Novo arquivo detectado: ${file}`);
        const filePath = path.join(publicDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        
        let name = file.replace('.txt', '').replace(/-/g, ' ');
        let color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');

        // Check if it already has a header (Line 1: Title, Line 2: Hex Color)
        const hasHeader = lines.length >= 2 && /^#[0-9A-Fa-f]{6}$/i.test(lines[1]);
        
        if (hasHeader) {
          name = lines[0];
          color = lines[1];
          // Limpa o arquivo .txt removendo o cabeçalho
          const cleanContent = lines.slice(2).join('\n');
          fs.writeFileSync(filePath, cleanContent, 'utf-8');
          console.log(`[SYNC] Arquivo ${file} limpo (cabeçalho movido para o índice).`);
        }
        
        index.push({ file, name, color, enabled: false });
        addedFiles.push(file);
        updated = true;
      }
    }
    
    if (updated) {
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      console.log(`[SYNC] library_index.json atualizado.`);
    }
    
    return { success: true, updated, addedFiles };
  }

  // API to sync library
  app.get("/api/library/sync", (req, res) => {
    const result = syncLibrary();
    res.json(result);
  });

  // API to get library.json (for debugging)
  app.get("/api/library/debug", (req, res) => {
    const libraryPath = path.resolve(process.cwd(), "public", "library.json");
    if (fs.existsSync(libraryPath)) {
      const content = fs.readFileSync(libraryPath, "utf-8");
      res.json({ success: true, path: libraryPath, size: content.length, content: JSON.parse(content) });
    } else {
      res.status(404).json({ success: false, error: "Arquivo não encontrado", path: libraryPath });
    }
  });

  // API to update library.json
  app.post("/api/library/update", (req, res) => {
    console.log("[DEBUG] Corpo da requisição recebido:", JSON.stringify(req.body).substring(0, 200) + "...");
    const { category, tags } = req.body;
    
    if (!category || !tags || !Array.isArray(tags) || tags.length === 0) {
      console.log("[DEBUG] Falha na validação da requisição:", { category, tagsCount: tags?.length });
      return res.status(400).json({ success: false, error: "Categoria ou tags inválidas. Certifique-se de enviar um nome de categoria e uma lista de tags." });
    }

    const libraryPath = path.resolve(process.cwd(), "public", "library.json");

    console.log(`[DEBUG] Caminho absoluto do library.json: ${libraryPath}`);
    console.log(`[DEBUG] Recebida solicitação de atualização para categoria: "${category}" (${tags.length} tags)`);

    try {
      // Check if directory exists
      const publicDir = path.resolve(process.cwd(), "public");
      if (!fs.existsSync(publicDir)) {
        console.log(`[DEBUG] Criando diretório public em: ${publicDir}`);
        fs.mkdirSync(publicDir, { recursive: true });
      }

      let library: any = { categories: {}, wildcards: {} };
      if (fs.existsSync(libraryPath)) {
        try {
          const content = fs.readFileSync(libraryPath, "utf-8");
          console.log(`[DEBUG] Conteúdo atual do library.json lido (${content.length} bytes)`);
          library = JSON.parse(content);
          if (!library.categories) library.categories = {};
          if (!library.wildcards) library.wildcards = {};
        } catch (e) {
          console.error("[ERROR] Erro ao parsear library.json existente:", e);
        }
      } else {
        console.log(`[DEBUG] library.json não existe, criando novo objeto.`);
      }

      // Find or create category key
      // We'll try to find an existing category by its name property
      let categoryKey = Object.keys(library.categories).find(
        k => library.categories[k].name.trim() === category.trim()
      );

      // If not found by exact name, try to find by name without icon
      if (!categoryKey) {
        const getCleanName = (name: string) => {
          const parts = name.split(' ');
          return parts.length > 1 ? parts.slice(1).join(' ').trim() : name.trim();
        };
        
        const targetCleanName = getCleanName(category);
        categoryKey = Object.keys(library.categories).find(k => {
          const existingCleanName = getCleanName(library.categories[k].name);
          return existingCleanName === targetCleanName;
        });
      }

      if (!categoryKey) {
        // Generate a new key if not found
        categoryKey = category.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
          .replace(/[^a-z0-9]/g, '_')
          .replace(/^_+|_+$/g, '')
          .substring(0, 30);
        
        if (!categoryKey || library.categories[categoryKey]) {
          categoryKey = 'cat_' + Date.now().toString().slice(-6);
        }
        console.log(`[DEBUG] Nova categoria detectada. Gerando chave: ${categoryKey}`);
      } else {
        console.log(`[DEBUG] Categoria existente encontrada. Chave: ${categoryKey}`);
      }

      if (!library.categories[categoryKey]) {
        library.categories[categoryKey] = { name: category, tags: [] };
      } else {
        // Update the name (in case the icon changed)
        if (library.categories[categoryKey].name !== category) {
          console.log(`[DEBUG] Atualizando nome da categoria de "${library.categories[categoryKey].name}" para "${category}"`);
          library.categories[categoryKey].name = category;
        }
      }

      // Add new tags, avoiding duplicates
      const existingTagsCount = library.categories[categoryKey].tags.length;
      const existingTags = new Set(library.categories[categoryKey].tags);
      let addedCount = 0;
      tags.forEach(t => {
        if (t && typeof t === 'string') {
          const trimmed = t.trim();
          if (!existingTags.has(trimmed)) {
            existingTags.add(trimmed);
            addedCount++;
          }
        }
      });
      library.categories[categoryKey].tags = Array.from(existingTags);

      console.log(`[DEBUG] Categoria "${categoryKey}": ${existingTagsCount} tags existentes, ${addedCount} novas tags adicionadas. Total: ${library.categories[categoryKey].tags.length}`);
      
      const jsonString = JSON.stringify(library, null, 2);
      fs.writeFileSync(libraryPath, jsonString, 'utf-8');
      
      // Verify write
      const stats = fs.statSync(libraryPath);
      console.log(`[DEBUG] Arquivo salvo com sucesso em: ${libraryPath}. Tamanho final: ${stats.size} bytes.`);
      
      return res.json({ 
        success: true, 
        message: `Categoria "${category}" atualizada com sucesso no servidor! ${addedCount} novas tags adicionadas (Total: ${library.categories[categoryKey].tags.length}).` 
      });
    } catch (error) {
      console.error("Erro ao atualizar library.json:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API to create a new .txt library file and update library_index.json
  app.post("/api/library/create-txt", (req, res) => {
    const { title, color, tags } = req.body;
    
    if (!title || !tags || !Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ success: false, error: "Dados inválidos." });
    }

    try {
      const publicDir = path.resolve(process.cwd(), "public");
      const safeTitle = title.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      
      const filename = `custom_${safeTitle}_${Date.now()}.txt`;
      const filePath = path.join(publicDir, filename);
      
      // Create .txt content (tags only)
      fs.writeFileSync(filePath, tags.join('\n'), 'utf-8');
      
      // Update library_index.json
      const indexPath = path.join(publicDir, "library_index.json");
      let index: any[] = [];
      if (fs.existsSync(indexPath)) {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      }
      
      if (!index.find(item => item.file === filename)) {
        index.push({
          file: filename,
          name: title,
          color: color || '#808080',
          enabled: true
        });
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      }
      
      res.json({ success: true, filename, message: `Arquivo ${filename} criado e adicionado ao índice.` });
    } catch (error) {
      console.error("Erro ao criar arquivo .txt:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API to delete category from library.json
  app.delete("/api/library/category/:name", (req, res) => {
    const categoryName = req.params.name;
    const libraryPath = path.resolve(process.cwd(), "public", "library.json");

    console.log(`[DEBUG] Recebida solicitação de exclusão para categoria: "${categoryName}"`);

    try {
      if (!fs.existsSync(libraryPath)) {
        console.log(`[DEBUG] Arquivo library.json não encontrado em: ${libraryPath}`);
        return res.status(404).json({ success: false, error: "Arquivo library.json não encontrado." });
      }

      const library = JSON.parse(fs.readFileSync(libraryPath, "utf-8"));
      
      // Find the key by name
      const categoryKey = Object.keys(library.categories).find(
        k => library.categories[k].name.trim() === categoryName.trim()
      );

      if (!categoryKey) {
        return res.status(404).json({ success: false, error: `Categoria "${categoryName}" não encontrada.` });
      }

      delete library.categories[categoryKey];
      fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2));

      res.json({ success: true, message: `Categoria "${categoryName}" excluída com sucesso.` });
    } catch (error) {
      console.error("Erro ao excluir categoria:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Sincroniza a biblioteca na inicialização
    try {
      syncLibrary();
    } catch (e) {
      console.error("[ERROR] Erro na sincronização inicial:", e);
    }
  });
}

startServer();
