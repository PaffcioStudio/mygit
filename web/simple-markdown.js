/**
 * Simple Markdown Parser - Enhanced Edition
 * Obsługuje podstawowe formatowanie Markdown + TABELE + lepsze odstępy
 */

const marked = {
  parse: function(markdown) {
    if (!markdown) return '';
    
    let html = markdown;
    
    // Normalizuj line endings
    html = html.replace(/\r\n/g, '\n');
    html = html.replace(/\r/g, '\n');
    
    // === TABELE (muszą być przed innymi transformacjami) ===
    html = this.parseTables(html);
    
    // === CODE BLOCKS (muszą być przed innymi transformacjami) ===
    // Zapisz code blocks żeby nie były transformowane
    const codeBlocks = [];
    html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, function(match, lang, code) {
      const placeholder = `___CODEBLOCK_${codeBlocks.length}___`;
      codeBlocks.push('<pre><code class="language-' + (lang || 'plaintext') + '">' + 
                      escapeHtml(code.trim()) + 
                      '</code></pre>');
      return placeholder;
    });
    
    // === HEADERS (muszą być na początku linii) ===
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // === HORIZONTAL RULES (przed list processing) ===
    html = html.replace(/^\n?---\n?$/gim, '\n<hr>\n');
    html = html.replace(/^\n?\*\*\*\n?$/gim, '\n<hr>\n');
    html = html.replace(/^\n?___\n?$/gim, '\n<hr>\n');
    
    // === BLOCKQUOTES ===
    html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
    
    // === LISTS ===
    html = this.parseLists(html);
    
    // === INLINE FORMATTING ===
    // Bold **text** lub __text__ (nie w środku słowa)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Italic *text* lub _text_ (nie w środku słowa)
    html = html.replace(/(?<!\w)\*([^\*]+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');
    
    // Strikethrough ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    
    // Inline code `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto;">');
    
    // === PARAGRAPHS ===
    // Split by double newlines to create paragraphs
    const blocks = html.split(/\n\n+/);
    const processedBlocks = blocks.map(block => {
      block = block.trim();
      if (!block) return '';
      
      // Nie otaczaj paragrafami jeśli to już jest HTML tag
      if (block.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr|table)/)) {
        return block;
      }
      
      // Single line breaks within paragraph
      block = block.replace(/\n/g, '<br>');
      
      return '<p>' + block + '</p>';
    });
    
    html = processedBlocks.join('\n\n');
    
    // === PRZYWRÓĆ CODE BLOCKS ===
    codeBlocks.forEach((code, i) => {
      html = html.replace(`___CODEBLOCK_${i}___`, code);
    });
    
    // === CLEANUP ===
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/\n{3,}/g, '\n\n');
    
    return html.trim();
  },
  
  /**
   * Parser dla tabel Markdown
   */
  parseTables: function(text) {
    const lines = text.split('\n');
    const result = [];
    let inTable = false;
    let tableLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      
      // Wykryj początek tabeli (linia z | i następna linia z |---|)
      if (!inTable && line.includes('|') && nextLine && nextLine.match(/^\|?[\s:|-]+\|?$/)) {
        inTable = true;
        tableLines = [line];
        continue;
      }
      
      // Zbieraj linie tabeli
      if (inTable) {
        if (line.includes('|')) {
          tableLines.push(line);
        } else {
          // Koniec tabeli
          result.push(this.buildTable(tableLines));
          result.push(line);
          inTable = false;
          tableLines = [];
        }
      } else {
        result.push(line);
      }
    }
    
    // Jeśli tabela była na końcu
    if (inTable && tableLines.length > 0) {
      result.push(this.buildTable(tableLines));
    }
    
    return result.join('\n');
  },
  
  /**
   * Buduje HTML table z linii Markdown
   */
  buildTable: function(lines) {
    if (lines.length < 2) return lines.join('\n');
    
    const headerLine = lines[0];
    const alignLine = lines[1];
    const bodyLines = lines.slice(2);
    
    // Parse alignment
    const alignments = alignLine.split('|')
      .map(cell => cell.trim())
      .filter(cell => cell)
      .map(cell => {
        if (cell.match(/^:-+:$/)) return 'center';
        if (cell.match(/^-+:$/)) return 'right';
        if (cell.match(/^:-+$/)) return 'left';
        return 'left';
      });
    
    // Parse header
    const headers = headerLine.split('|')
      .map(cell => cell.trim())
      .filter(cell => cell);
    
    // Parse body
    const rows = bodyLines.map(line => 
      line.split('|')
        .map(cell => cell.trim())
        .filter(cell => cell !== '')
    ).filter(row => row.length > 0);
    
    // Build HTML
    let html = '<table>\n<thead>\n<tr>\n';
    headers.forEach((header, i) => {
      const align = alignments[i] || 'left';
      html += `  <th style="text-align: ${align}">${header}</th>\n`;
    });
    html += '</tr>\n</thead>\n<tbody>\n';
    
    rows.forEach(row => {
      html += '<tr>\n';
      row.forEach((cell, i) => {
        const align = alignments[i] || 'left';
        html += `  <td style="text-align: ${align}">${cell}</td>\n`;
      });
      html += '</tr>\n';
    });
    
    html += '</tbody>\n</table>';
    
    return html;
  },
  
  /**
   * Parser dla list (unordered i ordered)
   */
  parseLists: function(text) {
    const lines = text.split('\n');
    const result = [];
    let inList = false;
    let listType = null; // 'ul' or 'ol'
    let listItems = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Unordered list item
      const ulMatch = trimmed.match(/^[*+-] (.+)$/);
      // Ordered list item
      const olMatch = trimmed.match(/^\d+\. (.+)$/);
      
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          // Zakończ poprzednią listę jeśli była
          if (inList) {
            result.push(this.buildList(listType, listItems));
            listItems = [];
          }
          inList = true;
          listType = 'ul';
        }
        listItems.push(ulMatch[1]);
      } else if (olMatch) {
        if (!inList || listType !== 'ol') {
          // Zakończ poprzednią listę jeśli była
          if (inList) {
            result.push(this.buildList(listType, listItems));
            listItems = [];
          }
          inList = true;
          listType = 'ol';
        }
        listItems.push(olMatch[1]);
      } else {
        // Nie jest elementem listy
        if (inList) {
          result.push(this.buildList(listType, listItems));
          inList = false;
          listType = null;
          listItems = [];
        }
        result.push(line);
      }
    }
    
    // Jeśli lista była na końcu
    if (inList && listItems.length > 0) {
      result.push(this.buildList(listType, listItems));
    }
    
    return result.join('\n');
  },
  
  /**
   * Buduje HTML list
   */
  buildList: function(type, items) {
    const tag = type === 'ul' ? 'ul' : 'ol';
    let html = `<${tag}>\n`;
    items.forEach(item => {
      html += `  <li>${item}</li>\n`;
    });
    html += `</${tag}>`;
    return html;
  }
};

// Helper do escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Export dla compatibility
if (typeof window !== 'undefined') {
  window.marked = marked;
}