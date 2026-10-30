/* Local-only SVG outline renderer. Preview and PNG consume the same immutable SVG. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('seal-form');
  const fonts = {
    myeongjo: { label: '명조 · 본명조 (한글·한자)', file: 'myeongjo.ttf' },
    batang: { label: '바탕 · 고운바탕 (한글)', file: 'batang.ttf' },
    gothic: { label: '고딕 · 본고딕 (한글·한자)', file: 'gothic.ttf' },
    brush: { label: '붓글씨 · 나눔손글씨 붓 (한글)', file: 'brush.ttf' }
  };
  document.querySelectorAll('.seal-font-options').forEach(select => {
    for (const [key, font] of Object.entries(fonts)) select.add(new Option(font.label, key));
  });
  let kind = 'personal', shape = 'circle', view = 'transparent', version = 0;
  let current = null, reference = null, refURL = null, refVersion = 0;
  let personalName = '홍길동', companyName = '주식회사샘플';
  const cache = new Map();
  const chars = text => Array.from(text.replace(/\s/gu, ''));
  const n = value => Number(value);
  const esc = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const get = name => form.elements.namedItem(name);
  const state = () => ({ ...Object.fromEntries(new FormData(form)), kind, shape });
  function setPressed(selector, key, value) {
    document.querySelectorAll(selector).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[key] === value)));
  }
  async function loadFont(key) {
    if (!cache.has(key)) cache.set(key, fetch(`assets/stamp/fonts/${fonts[key].file}`).then(r => {
      if (!r.ok) throw Error('글꼴 파일을 불러오지 못했습니다. 연결을 확인한 뒤 설정을 다시 변경해 주세요.');
      return r.arrayBuffer();
    }).then(buffer => opentype.parse(buffer)).catch(error => { cache.delete(key); throw error; }));
    return cache.get(key);
  }
  function checkGlyphs(font, text) {
    const missing = [...new Set(chars(text).filter(c => font.charToGlyphIndex(c) === 0))];
    if (missing.length) throw Error(`이 글꼴이 지원하지 않는 문자: ${missing.join(' ')}. 명조·바탕 등 다른 글꼴을 선택하거나 문구를 수정해 주세요.`);
  }
  // Every glyph is fitted by its actual outline bounds, never a platform fallback font.
  function glyph(font, c, x, y, width, height, rotation = 0) {
    const path = font.charToGlyph(c).getPath(0, 0, 100);
    const b = path.getBoundingBox();
    const bw = b.x2-b.x1, bh = b.y2-b.y1;
    if (!bw || !bh) return '';
    const angle = Math.abs(rotation)*Math.PI/180;
    const scale = Math.min(width/(bw*Math.cos(angle)+bh*Math.sin(angle)), height/(bh*Math.cos(angle)+bw*Math.sin(angle)));
    return `<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale}) translate(${-(b.x1+b.x2)/2} ${-(b.y1+b.y2)/2})"><path d="${path.toPathData(3)}"/></g>`;
  }
  function grid(font, text, box, layout, size, spacing, rotation, align) {
    const list = chars(text), count = list.length;
    if (!count) return '';
    let rows, cols;
    if (layout === 'horizontal') { rows=1; cols=count; }
    else if (layout === 'vertical') { rows=count; cols=1; }
    else if (layout === 'columns') { cols=Math.min(2,count); rows=Math.ceil(count/cols); }
    else { cols=Math.max(1,Math.ceil(Math.sqrt(count*box.w/box.h))); rows=Math.ceil(count/cols); }
    const cw=box.w/cols, ch=box.h/rows;
    const scale=Math.min(1,n(size)/120);
    const gw=Math.max(1,cw-Math.min(n(spacing),cw*.4)), gh=Math.max(1,ch-Math.min(n(spacing),ch*.4));
    return list.map((c,i) => {
      const vertical=layout==='vertical'||layout==='columns'||(layout==='auto' && box.w<=box.h*1.4);
      const col=vertical ? cols-1-Math.floor(i/rows) : i%cols;
      const row=vertical ? i%rows : Math.floor(i/cols);
      let x=box.x+(col+.5)*cw, y=box.y+(row+.5)*ch;
      if (layout==='horizontal' && align!=='center') y+= (align==='start'?-1:1)*(ch-gh*scale)/3;
      if (layout==='vertical' && align!=='center') x+= (align==='start'?-1:1)*(cw-gw*scale)/3;
      return glyph(font,c,x,y,gw*scale,gh*scale,n(rotation));
    }).join('');
  }
  function render(s, mainFont, titleFont) {
    const w=s.shape==='rectangle'?360:s.shape==='ellipse'?210:280;
    const h=s.shape==='rectangle'?200:s.shape==='ellipse'?300:280;
    const cx=w/2, cy=h/2, bw=n(s.border), inset=5+bw/2;
    const oval=s.shape==='circle'||s.shape==='ellipse';
    const border=(d,stroke=bw) => oval
      ? `<ellipse cx="${cx}" cy="${cy}" rx="${cx-d}" ry="${cy-d}" fill="none" stroke="${s.color}" stroke-width="${stroke}"/>`
      : `<rect x="${d}" y="${d}" width="${w-2*d}" height="${h-2*d}" fill="none" stroke="${s.color}" stroke-width="${stroke}"/>`;
    let body=border(inset);
    if(s.borderMode==='double') body+=border(inset+bw+5,Math.max(1,bw*.6));
    const inner=inset+(s.borderMode==='double'?bw+10:7);
    if(s.kind==='corporate'&&oval) {
      const list=chars(s.name), radiusX=cx-inner-20, radiusY=cy-inner-20;
      const sweep=300*Math.PI/180;
      // Chord spacing caps size even on long names and narrow ellipses.
      const slot=Math.min(radiusX,radiusY)*sweep/Math.max(list.length,1);
      const fs=Math.min(36,slot*.78)*Math.min(1,n(s.fontSize)/120);
      list.forEach((c,i) => {
        const a=-Math.PI/2-sweep/2+sweep*(i+.5)/list.length;
        const x=cx+radiusX*Math.cos(a), y=cy+radiusY*Math.sin(a);
        const tangent=Math.atan2(radiusY*Math.cos(a),-radiusX*Math.sin(a))*180/Math.PI;
        body+=`<g data-company-glyph="${i}" transform="translate(${x} ${y}) rotate(${tangent})">${glyph(mainFont,c,0,0,Math.max(1,Math.min(fs,slot-n(s.spacing))),fs,n(s.glyphRotation))}</g>`;
      });
      if(s.mark) body+=glyph(mainFont,s.mark,cx,cy+radiusY,12,12);
      const r=Math.min(radiusX,radiusY)-28;
      if(s.borderMode==='double') body+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${Math.max(1,bw*.6)}"/>`;
      const side=(r-9)*Math.SQRT2;
      const dx=n(s.titleX),dy=n(s.titleY);
      body+=grid(titleFont,s.title,{x:cx-side/2+dx,y:cy-side/2+dy,w:side-Math.abs(dx)*2,h:side-Math.abs(dy)*2},s.titleLayout,s.titleSize,s.titleSpacing,s.glyphRotation,s.align);
    } else {
      // Inscribed rectangle keeps all glyphs inside curved borders.
      const margin=inner+(oval?Math.min(w,h)*.15:7);
      const box={x:margin,y:margin,w:w-margin*2,h:h-margin*2};
      if(s.kind==='corporate') {
        body+=grid(mainFont,s.name,{...box,h:box.h*.58},s.layout,s.fontSize,s.spacing,s.glyphRotation,s.align);
        body+=grid(titleFont,s.title,{x:box.x+n(s.titleX),y:box.y+box.h*.65+n(s.titleY),w:box.w-Math.abs(n(s.titleX))*2,h:box.h*.3-Math.abs(n(s.titleY))},s.titleLayout,s.titleSize,s.titleSpacing,s.glyphRotation,s.align);
      } else body+=grid(mainFont,s.name+s.suffix,box,s.layout,s.fontSize,s.spacing,s.glyphRotation,s.align);
    }
    let defs='';
    if(n(s.texture)) {
      // Fixed seed: subtle alpha-only pinholes reproduce exactly in exported PNG.
      let holes=''; let seed=1977;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<n(s.texture)*350;i++) holes+=`<circle cx="${random()*w}" cy="${random()*h}" r="${.2+random()*.65}" fill="black" opacity="${.25+random()*.4}"/>`;
      defs=`<defs><mask id="seal-ink" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="white"/>${holes}</mask></defs>`;
      body=`<g mask="url(#seal-ink)">${body}</g>`;
    }
    const rad=n(s.rotation)*Math.PI/180;
    const c=Math.abs(Math.cos(rad)),t=Math.abs(Math.sin(rad));
    const outW=oval?Math.sqrt(w*w*c*c+h*h*t*t):w*c+h*t;
    const outH=oval?Math.sqrt(w*w*t*t+h*h*c*c):w*t+h*c;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outW} ${outH}" width="${outW}" height="${outH}" fill="${s.color}" aria-label="${esc(s.name)} 도장"><title>${esc(s.name)} 도장</title>${defs}<g transform="translate(${outW/2} ${outH/2}) rotate(${s.rotation}) translate(${-cx} ${-cy})">${body}</g></svg>`;
    return {svg,w:outW,h:outH,s};
  }
  function languageHint(text, language, label) {
    const clean=text.replace(/[\s·◆]/gu,'');
    if(language==='hangul'&&/[^\p{Script=Hangul}]/u.test(clean)) return `${label}에 한글 외 문자가 있습니다. 혼합을 선택할 수 있습니다.`;
    if(language==='hanja'&&/[^\p{Script=Han}]/u.test(clean)) return `${label}에 한자 외 문자가 있습니다. 혼합을 선택할 수 있습니다.`;
    return '';
  }
  async function refresh() {
    const mine=++version,s=state();
    current=null; $('seal-download').disabled=true;
    $('seal-status').dataset.error='false';
    $('seal-status').textContent='도장을 생성하는 중입니다…';
    form.querySelectorAll('input[type=range]').forEach(input=>input.previousElementSibling.textContent=input.value);
    try {
      if(!chars(s.name).length) throw Error(s.kind==='personal'?'개인 이름을 입력해 주세요.':'회사명을 입력해 주세요.');
      if(s.kind==='corporate'&&!chars(s.title).length) throw Error('중앙 직함을 입력해 주세요.');
      if(!Number.isFinite(n(s.mm))||n(s.mm)<5||n(s.mm)>100) throw Error('실물 도장 너비는 5~100mm로 입력해 주세요.');
      const [f,tf]=await Promise.all([loadFont(s.font),s.kind==='corporate'?loadFont(s.titleFont):Promise.resolve(null)]);
      if(mine!==version) return;
      checkGlyphs(f,s.name+(s.kind==='personal'?s.suffix:s.mark));
      if(tf) checkGlyphs(tf,s.title);
      current=render(s,f,tf);
      $('seal-art').innerHTML=current.svg;
      updateDisplay();
      $('seal-status').textContent=[languageHint(s.name,s.language,'이름 / 회사명'),s.kind==='corporate'?languageHint(s.title,s.titleLanguage,'중앙 직함'):'','투명 PNG로 저장할 준비가 되었습니다.'].filter(Boolean).join(' ');
      $('seal-download').disabled=false;
    } catch(error) {
      if(mine!==version) return;
      $('seal-art').replaceChildren();
      $('seal-status').dataset.error='true';
      $('seal-status').textContent=error.message;
    }
  }
  function updateDisplay() {
    if(!current) return;
    const {w,h,s}=current,zoom=n($('seal-zoom').value)/100;
    const width=view==='actual'?n(s.mm)*96/25.4:Math.min(250,$('seal-stage').clientWidth-55);
    const factor=view==='actual'?1:zoom;
    $('seal-art').style.width=`${width*factor}px`;
    $('seal-art').style.height=`${width*h/w*factor}px`;
    $('seal-zoom').disabled=view==='actual';
    $('seal-zoom-value').textContent=view==='actual'?'1:1':`${Math.round(zoom*100)}%`;
    $('seal-dimensions').textContent=`${s.mm} × ${(n(s.mm)*h/w).toFixed(1)} mm`;
    const size=n($('seal-resolution').value),pw=w>=h?size:Math.round(size*w/h),ph=h>=w?size:Math.round(size*h/w);
    $('seal-pixels').textContent=`${pw} × ${ph} px · 투명 배경`;
  }
  async function png(snapshot, size) {
    const canvas=document.createElement('canvas');
    canvas.width=snapshot.w>=snapshot.h?size:Math.round(size*snapshot.w/snapshot.h);
    canvas.height=snapshot.h>=snapshot.w?size:Math.round(size*snapshot.h/snapshot.w);
    const url=URL.createObjectURL(new Blob([snapshot.svg],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const image=new Image(); image.src=url; await image.decode();
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 변환에 실패했습니다.')),'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
  form.addEventListener('submit',e=>e.preventDefault());
  form.addEventListener('input',e=>{if(e.target.type!=='file') { if(e.target.name==='title') $('seal-title-preset').value='custom'; refresh(); }});
  form.addEventListener('change',e=>{if(e.target.matches('select')&&!e.target.id) refresh();});
  form.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b) return;
    if(b.dataset.kind) {
      if(kind==='personal') personalName=get('name').value;else companyName=get('name').value;
      kind=b.dataset.kind; get('name').value=kind==='personal'?personalName:companyName;
      shape='circle';
      $('seal-corporate').hidden=kind!=='corporate';$('seal-center-settings').hidden=kind!=='corporate';$('seal-suffix-label').hidden=kind==='corporate';
      $('seal-name-label').textContent=kind==='personal'?'개인 이름':'회사명';
      setPressed('[data-kind]','kind',kind);setPressed('[data-shape]','shape',shape);refresh();
    }
    if(b.dataset.shape){shape=b.dataset.shape;setPressed('[data-shape]','shape',shape);refresh();}
    if(b.dataset.color){get('color').value=b.dataset.color;setPressed('[data-color]','color',b.dataset.color);refresh();}
  });
  get('color').addEventListener('input',()=>setPressed('[data-color]','color',get('color').value));
  $('seal-title-preset').addEventListener('change',e=>{if(e.target.value!=='custom'){get('title').value=e.target.value;refresh();}});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;$('seal-stage').dataset.view=view;setPressed('[data-view]','view',view);updateDisplay();}));
  $('seal-zoom').addEventListener('input',updateDisplay);
  $('seal-zoom-reset').addEventListener('click',()=>{$('seal-zoom').value=100;updateDisplay();});
  $('seal-resolution').addEventListener('change',updateDisplay);
  window.addEventListener('resize',updateDisplay);
  $('seal-download').addEventListener('click',async()=>{
    const snapshot=current;if(!snapshot)return;
    $('seal-download').disabled=true;
    try {
      const blob=await png(snapshot,n($('seal-resolution').value));
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`${snapshot.s.kind==='personal'?'개인도장':'법인도장'}_${snapshot.s.name.replace(/[\\/:*?"<>|\s]/g,'_')}.png`;
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      $('seal-status').textContent='투명 PNG를 저장했습니다. 문서에 이미지를 삽입해 사용하세요.';
    }catch(error){$('seal-status').textContent=error.message;}
    finally{$('seal-download').disabled=!current;}
  });
  function clearReference(){refVersion++;reference=null;if(refURL)URL.revokeObjectURL(refURL);refURL=null;$('seal-reference').value='';$('seal-reference-preview').hidden=true;$('seal-reference-preview').removeAttribute('src');$('seal-reference-apply').disabled=true;$('seal-reference-info').textContent='이미지의 잉크 영역과 종횡비를 분석해 모양을 추천합니다. 문구는 직접 입력합니다.';}
  $('seal-reference-clear').addEventListener('click',clearReference);
  $('seal-reset').addEventListener('click',()=>{
    form.reset();kind='personal';shape='circle';personalName='홍길동';companyName='주식회사샘플';
    $('seal-corporate').hidden=true;$('seal-center-settings').hidden=true;$('seal-suffix-label').hidden=false;$('seal-name-label').textContent='개인 이름';
    setPressed('[data-kind]','kind',kind);setPressed('[data-shape]','shape',shape);setPressed('[data-color]','color',get('color').value);
    view='transparent';$('seal-stage').dataset.view=view;setPressed('[data-view]','view',view);$('seal-zoom').value=100;$('seal-resolution').value='1024';clearReference();refresh();
  });
  $('seal-reference').addEventListener('change',async e=>{
    const file=e.target.files[0];clearReference();if(!file)return;
    const mine=refVersion;
    try{
      if(file.size>12*1024*1024)throw Error('12MB 이하의 이미지를 선택해 주세요.');
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('PNG, JPEG, WebP 이미지를 선택해 주세요.');
      refURL=URL.createObjectURL(file);const image=new Image();image.src=refURL;await image.decode();if(mine!==refVersion)return;
      const canvas=document.createElement('canvas'),scale=Math.min(1,512/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
      const ink=(x,y)=>{const i=(y*canvas.width+x)*4;return data[i+3]>60&&Math.min(data[i],data[i+1],data[i+2])<180;};
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(ink(x,y)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      if(x1<x0)throw Error('잉크 영역을 찾지 못했습니다. 밝은 배경의 도장 이미지를 선택해 주세요.');
      let corners=0,total=0;const iw=x1-x0+1,ih=y1-y0+1;
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if((x<x0+iw*.16||x>x1-iw*.16)&&(y<y0+ih*.16||y>y1-ih*.16)){total++;if(ink(x,y))corners++;}
      const ratio=iw/ih,round=corners/Math.max(total,1)<.08;
      reference={shape:round?(ratio>.88&&ratio<1.12?'circle':'ellipse'):(ratio>.88&&ratio<1.12?'square':'rectangle')};
      // Ellipse preset is vertical; wide references need explicit manual choice.
      const names={circle:'원형',ellipse:'타원형',square:'정사각형',rectangle:'직사각형'};
      $('seal-reference-preview').src=refURL;$('seal-reference-preview').hidden=false;
      $('seal-reference-info').textContent=`잉크 영역 비율 ${ratio.toFixed(2)}:1 · ${names[reference.shape]} 추천 (추정). 문구·테두리 수·배치는 자동 인식하지 않습니다. 이미지를 참고해 직접 조정해 주세요.`;
      $('seal-reference-apply').disabled=false;
    }catch(error){if(mine===refVersion)$('seal-reference-info').textContent=error.message;}
  });
  $('seal-reference-apply').addEventListener('click',()=>{if(reference){shape=reference.shape;setPressed('[data-shape]','shape',shape);refresh();}});
  // Small public surface for tab activation and browser regression tests.
  window.SealStudio={refresh, png, snapshot:()=>current};
  refresh();
})();
