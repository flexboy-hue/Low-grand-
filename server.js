/*
 Inspired2Site - fullstack starter (v2)
 Backend routes:
  - GET  /api/health
  - POST /api/analyze  { url }
  - POST /api/generate-image { prompt }
  - POST /api/export { project }  -> returns zip
 Notes: set SUPABASE_URL, SUPABASE_KEY, HF_API_KEY in env for full features.
*/
const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const { createClient } = require('@supabase/supabase-js');
const formidable = require('formidable');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// optional supabase client
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// serve static frontend
app.use('/', express.static(path.join(__dirname, 'frontend')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Basic robots.txt check (simple)
async function checkRobots(url) {
  try {
    const u = new URL(url);
    const robotsUrl = u.origin + '/robots.txt';
    const r = await axios.get(robotsUrl, { timeout: 4000 }).then(r=>r.data).catch(()=> '');
    if (!r) return true;
    const lines = r.split(/\r?\n/).map(l=>l.trim());
    for (const ln of lines) {
      if (/^Disallow:/i.test(ln)) {
        const path = ln.split(':')[1].trim();
        if (path === '/') return false;
      }
    }
    return true;
  } catch(e){ return true; }
}

const PLUGIN_MAP = {
  "elementor": { slug:"elementor", name:"Elementor", author:"Elementor Ltd" },
  "metform": { slug:"metform", name:"MetForm", author:"WpMet" },
  "woocommerce": { slug:"woocommerce", name:"WooCommerce", author:"Automattic" },
  "contact-form-7": { slug:"contact-form-7", name:"Contact Form 7", author:"Takayuki Miyoshi" }
};

function detectPlugins(html) {
  const found = {};
  const lower = (html || '').toLowerCase();
  for (const key of Object.keys(PLUGIN_MAP)) {
    if (lower.includes(key) || lower.includes(key.replace('-', ''))) {
      found[key] = PLUGIN_MAP[key];
    }
  }
  return Object.values(found);
}

// analyze route
app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const allowed = await checkRobots(url);
    if (!allowed) return res.status(403).json({ error: 'Page disallowed by robots.txt' });

    const resp = await axios.get(url, { headers: { 'User-Agent': 'inspired2site-bot/1.0' }, timeout: 10000 });
    const html = resp.data;
    const $ = cheerio.load(html);

    const title = $('title').first().text() || '';
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const headings = [];
    for (let i=1;i<=4;i++){
      $(`h${i}`).each((_,el)=>headings.push({ tag: `h${i}`, text: $(el).text().trim() }));
    }

    // try to detect main blocks by selecting common containers
    const blocks = [];
    const mainSel = $('main').length ? 'main' : 'body';
    $(mainSel).children().slice(0,20).each((_, el)=>{
      const node = $(el);
      blocks.push({
        tag: el.tagName || 'div',
        classes: (node.attr('class')||'').split(/\s+/).filter(Boolean),
        id: node.attr('id') || null,
        text: node.text().trim().slice(0,500),
        htmlSnippet: node.html() ? node.html().slice(0,800) : ''
      });
    });

    const images = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || null;
      if (src) images.push(src);
    });

    const pluginSignatures = detectPlugins(html);
    const bridgeDetections = [];
    if (html.toLowerCase().includes('rev_slider')) {
      bridgeDetections.push({ issueId:'revslider', description:'RevSlider-like content found', severity:'recommended'});
    }
    if (html.toLowerCase().includes('metform')) {
      bridgeDetections.push({ issueId:'metform', description:'MetForm-like form found', severity:'required'});
    }

    const analysis = { url, title, metaDesc, headings, blocks, images, pluginSignatures, bridgeDetections, analyzedAt: new Date().toISOString() };

    // save to supabase if available
    if (supabase) {
      try {
        await supabase.from('analyses').insert([{ url, data: analysis }]);
      } catch(e){ console.warn('supabase insert failed', e.message); }
    }

    res.json({ analysis });
  } catch (err) {
    console.error('analyze error', err && err.message);
    res.status(500).json({ error: 'Failed to analyze URL', detail: err.message });
  }
});

// simple image generation stub
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt = 'transparent product mockup' } = req.body;
    // If HF key provided try HF, otherwise return a 1x1 transparent demo
    if (process.env.HF_API_KEY) {
      try {
        const model = 'stabilityai/stable-diffusion-xl-base-1.0';
        const r = await axios.post(`https://api-inference.huggingface.co/models/${model}`, { inputs: prompt, options:{wait_for_model:true} }, { headers:{ Authorization: `Bearer ${process.env.HF_API_KEY}` }, responseType:'arraybuffer', timeout:60000 });
        const b64 = Buffer.from(r.data).toString('base64');
        return res.json({ success:true, mime:'image/png', data:`data:image/png;base64,${b64}`, source:'huggingface' });
      } catch(e){ console.warn('hf failed', e.message); }
    }
    // demo fallback: tiny transparent png
    const demo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
    res.json({ success:true, mime:'image/png', data: demo, source:'demo' });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// export route that produces a zip from a project object sent by client
app.post('/api/export', async (req, res) => {
  try {
    const { project = {} } = req.body;
    const zip = new JSZip();

    // build minimal index.html using project.blocks or project.html
    let indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${project.title || 'Inspired Export'}</title><link rel="stylesheet" href="miracle.css"></head><body><div class="site">`;
    if (project.blocks && project.blocks.length) {
      for (const b of project.blocks) {
        indexHtml += `<section class="miracle-section"><div class="container">${b.title?'<h2>'+b.title+'</h2>':''}${b.content||'<p>'+ (b.text || '...') +'</p>'}</div></section>`;
      }
    } else {
      indexHtml += `<main class="container"><h1>${project.title||'Generated site'}</h1><p>${project.metaDesc||''}</p></main>`;
    }
    indexHtml += `</div></body></html>`;

    // include miracle.css
    const miracleCss = fs.readFileSync(path.join(__dirname, 'frontend', 'miracle.css'), 'utf8');
    zip.file('index.html', indexHtml);
    zip.file('miracle.css', miracleCss);
    zip.file('plugin-list.txt', (project.plugins||[]).map(p=>p.name+' — '+p.author).join('\n')||'No plugins detected');
    zip.file('README.md', `Inspired2Site export\nGeneratedAt: ${new Date().toISOString()}\nNotes: verify assets/licenses.`);

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename=inspired2site-export.zip');
    res.send(content);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// file upload (images) route (multipart) - saves to /tmp and returns data URL
app.post('/api/upload-image', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false, uploadDir: os.tmpdir(), keepExtensions: true });
  form.parse(req, (err, fields, files) => {
    if (err) return res.status(500).json({ error: err.message });
    const f = files.file;
    if (!f) return res.status(400).json({ error: 'file missing' });
    const data = fs.readFileSync(f.filepath || f.path);
    const b64 = 'data:image/png;base64,' + data.toString('base64');
    res.json({ success:true, data: b64 });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`inspired2site server running on port ${PORT}`));
