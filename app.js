// Frontend assistant logic - improved generator + analyzer UI
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const imageBtn = document.getElementById('imageBtn');
const exportBtn = document.getElementById('exportBtn');
const fileInput = document.getElementById('file');
const previewArea = document.getElementById('previewArea');

function appendMsg(html, who='bot') {
  const d = document.createElement('div');
  d.className = `msg ${who==='user'?'user':'bot'}`;
  d.innerHTML = html;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showToast(t){ appendMsg('<small class="mini">'+t+'</small>'); }

// initial welcome
appendMsg('<strong>Welcome — paste a URL and click Analyze, or upload an image / type instructions.</strong>');

sendBtn.onclick = () => {
  const v = inputEl.value.trim();
  if (!v) return;
  appendMsg(escapeHtml(v), 'user');
  inputEl.value = '';
  // simple command parsing
  if (isUrl(v)) { doAnalyze(v); return; }
  appendMsg('I heard: '+escapeHtml(v));
};

analyzeBtn.onclick = async () => {
  let url = inputEl.value.trim();
  if (!isUrl(url)) url = prompt('Enter a URL to analyze (include https://):');
  if (!url) return;
  await doAnalyze(url);
};

fileInput.onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  appendMsg('Uploading image for inspiration...', 'user');
  // read as data url and show small preview
  const reader = new FileReader();
  reader.onload = async () => {
    const data = reader.result;
    appendMsg('<img src="'+data+'" style="max-width:200px;border-radius:8px"/>', 'user');
    // send to backend upload (optional) or keep local as inspiration
    previewArea.innerHTML = `<h4>Image Inspiration</h4><img src="${data}" style="max-width:100%"/>`;
  };
  reader.readAsDataURL(f);
};

imageBtn.onclick = async () => {
  const prompt = prompt('Image prompt (example: "hero product, isolated, transparent background")','modern landing page mockup, isolated object, transparent background');
  if (!prompt) return;
  appendMsg('<strong>Generating image:</strong> '+escapeHtml(prompt), 'user');
  showToast('Requesting image...');

  try {
    const res = await fetch('/api/generate-image', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt })});
    const j = await res.json();
    if (j && j.data) {
      appendMsg('<div><em>Image result (source: '+(j.source||'demo')+')</em><br/><img src="'+j.data+'" style="max-width:100%"/></div>');
      previewArea.innerHTML = `<h4>Generated Image</h4><img src="${j.data}" style="max-width:100%"/>`;
    } else {
      appendMsg('Image generation failed.');
    }
  } catch(e){ appendMsg('Image generation error: '+e.message); }
};

exportBtn.onclick = async () => {
  // build a project object from preview content
  const project = {
    title: document.querySelector('#previewArea h4') ? document.querySelector('#previewArea h4').innerText : 'Generated site',
    metaDesc: '',
    blocks: []
  };
  // simple extraction from preview area to blocks
  const blocks = previewArea.querySelectorAll('section, div');
  blocks.forEach(b => {
    project.blocks.push({ title: b.querySelector('h3') ? b.querySelector('h3').innerText : '', content: b.innerHTML, text: b.innerText.slice(0,400) });
  });

  showToast('Requesting export ZIP...');
  try {
    const r = await fetch('/api/export', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project })});
    if (!r.ok) { appendMsg('Export failed: '+r.statusText); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'inspired2site-export.zip'; a.click();
    URL.revokeObjectURL(url);
    appendMsg('Export ready — started download.');
  } catch(e){ appendMsg('Export error: '+e.message); }
};

async function doAnalyze(url) {
  appendMsg('Analyzing '+escapeHtml(url)+' ...', 'user');
  try {
    const r = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url })});
    const j = await r.json();
    if (j.error) { appendMsg('Analysis error: '+escapeHtml(j.error)); return; }
    const a = j.analysis;
    // display summary
    let html = '<strong>Title:</strong> '+escapeHtml(a.title||'—')+'<br/>';
    html += '<strong>Headings:</strong><ul>';
    (a.headings||[]).slice(0,6).forEach(h => html += '<li>'+escapeHtml(h.tag)+' — '+escapeHtml(h.text)+'</li>');
    html += '</ul>';
    html += '<strong>Detected plugins:</strong><ul>';
    (a.pluginSignatures||[]).forEach(p => html += '<li>'+escapeHtml(p.name)+' — '+escapeHtml(p.author)+'</li>');
    html += '</ul>';
    appendMsg(html);

    // generate a simple multi-section preview from analysis
    const preview = buildPreviewFromAnalysis(a);
    previewArea.innerHTML = preview;
    appendMsg('Website generated! Preview on the right.');
  } catch(e){ appendMsg('Analyze failed: '+e.message); }
}

function buildPreviewFromAnalysis(a) {
  // choose a color based on site or fallback
  const accent = '#2f80ed';
  let out = '';
  out += `<header class="hero-preview"><h1>${escapeHtml(a.title||'Inspired site')}</h1><p>${escapeHtml(a.metaDesc||'Generated from inspiration.')}</p></header>`;
  // hero image
  out += `<section style="margin-top:16px;"><div class="hero-preview"><h3>Hero</h3><p>Auto-generated hero based on headings.</p></div></section>`;
  // features from headings
  if (a.headings && a.headings.length) {
    out += `<section><div class="hero-preview"><h3>Key headings</h3><ul>`;
    a.headings.slice(0,6).forEach(h => out += `<li>${escapeHtml(h.text)}</li>`);
    out += `</ul></div></section>`;
  }
  // blocks -> product cards
  if (a.blocks && a.blocks.length) {
    out += `<section><div class="hero-preview"><h3>Content Blocks</h3>`;
    a.blocks.slice(0,6).forEach(b => {
      out += `<article style="background:#fff;padding:12px;border-radius:8px;margin:8px 0;color:#111"><h4>${escapeHtml((b.classes||[]).join(' ')||b.tag)}</h4><p>${escapeHtml(b.text.slice(0,120))}</p></article>`;
    });
    out += `</div></section>`;
  }
  // plugin info & export hint
  out += `<section><div class="hero-preview"><h3>Plugins</h3><p>${(a.pluginSignatures||[]).map(p=>p.name+' by '+p.author).join(', ')||'None detected'}</p></div></section>`;
  return out;
}

function isUrl(s) { try { new URL(s); return true;} catch(e){ return false; } }
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
