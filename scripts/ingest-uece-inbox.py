#!/usr/bin/env python3
from __future__ import annotations
import argparse, concurrent.futures, importlib.util, json, re, sys
from dataclasses import dataclass
from pathlib import Path

spec=importlib.util.spec_from_file_location('enemlab_ingest_inbox_base',Path(__file__).resolve().with_name('ingest-inbox.py'))
assert spec and spec.loader
base=importlib.util.module_from_spec(spec); sys.modules[spec.name]=base; spec.loader.exec_module(base)

PARSER_VERSION='inbox-uece@0.1.0'; PROVIDER_ID='brasil-escola'; RIGHTS_STATUS='third-party-mirror-reference'
UECE_SLUG='universidade-estadual-ceara'; LETTERS=('A','B','C','D'); LANGS={'spanish','french','english'}
Q_RE=re.compile(r'^0?(\d{1,3})\s*[.)]\s*(.*)$'); A_RE=re.compile(r'^(?:\(([A-Da-d])\)|([A-Da-d])\s*[.)])\s*(.*)$')
CYCLE_RE=re.compile(r'\bvestibular\s+(20\d{2})\s*[./-]\s*([12])\b',re.I); YEAR_RE=re.compile(r'(?<!\d)((?:19|20)\d{2})(?!\d)')
TERM_RE=re.compile(r'(?<!\d)((?:19|20)\d{2})\s*/\s*([12])(?!\d)'); KEY_HEAD=re.compile(r'\bgabarito(?:\s+oficial)?(?:\s+(?:definitivo|preliminar))?\s*([1-4])\b')
VISUAL_RE=re.compile(r'\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o)\b',re.I)
SUBJECTS={'lingua portuguesa':('portugues','Língua Portuguesa'),'matematica':('matematica','Matemática'),'historia':('historia','História'),'geografia':('geografia','Geografia'),'fisica':('fisica','Física'),'quimica':('quimica','Química'),'biologia':('biologia','Biologia'),'educacao fisica':('educacao_fisica','Educação Física'),'filosofia':('filosofia','Filosofia'),'sociologia':('sociologia','Sociologia'),'lingua espanhola':('spanish','Língua Estrangeira - Espanhol'),'espanhol':('spanish','Língua Estrangeira - Espanhol'),'lingua francesa':('french','Língua Estrangeira - Francês'),'frances':('french','Língua Estrangeira - Francês'),'lingua inglesa':('english','Língua Estrangeira - Inglês'),'ingles':('english','Língua Estrangeira - Inglês')}

@dataclass
class Source:
    path:Path; meta:dict
    @property
    def title(self): return str(self.meta.get('title') or self.path.stem)

@dataclass
class Candidate:
    number:int; subject:str|None; label:str|None; statement:str; context:str; alts:dict[str,str]; page:int; mode:str
    @property
    def complete(self): return set(self.alts)==set(LETTERS) and bool(self.statement)
    @property
    def score(self): return (self.mode=='plain',len(self.context),len(self.statement)+sum(map(len,self.alts.values())))

def compact(v): return base.compact_space(v)
def deaccent(v): return base.deaccent(v)
def norm(v): return compact(re.sub(r'[^a-z0-9]+',' ',deaccent(compact(v))))

def sidecar(path):
    p=path.with_suffix(path.suffix+'.meta.json')
    try: return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}
    except Exception: return {}

def inputs(values):
    out=[]
    for raw in values or [f'.ingestion-inbox/brasil-escola/nordeste/{UECE_SLUG}']:
        p=Path(raw)
        if p.is_dir(): out.extend(sorted(p.rglob('*.zip')))
        elif p.is_file() and p.suffix.lower()=='.zip': out.append(p)
        elif not p.exists(): raise ValueError(f'input not found: {p}')
    return sorted(dict.fromkeys(out))

def is_uece(src):
    s=' '.join([str(src.meta.get('institutionSlug','')),str(src.meta.get('institution','')),src.title,' '.join(src.path.parts)])
    return UECE_SLUG in deaccent(s) or re.search(r'\buece\b',deaccent(s)) is not None

def fallback_cycle(src):
    m=TERM_RE.search(src.title)
    if m:return int(m.group(1)),int(m.group(2))
    try:y=int(src.meta.get('year'))
    except (TypeError,ValueError):
        m=YEAR_RE.search(src.title); y=int(m.group(1)) if m else None
    return (y,1) if y else (None,None)

def cycle(text,src):
    m=CYCLE_RE.search(deaccent(text))
    if m:return int(m.group(1)),int(m.group(2))
    m=re.search(r'\bvestibular\s+(20\d{2})\b',deaccent(text)); fy,ft=fallback_cycle(src)
    if m:
        y=int(m.group(1)); return y,ft if fy==y else 1
    return fy,ft

def phase(text,n): return bool(re.search(rf'\b{n}\s*a?\s*fase\b|\b{"primeira" if n==1 else "segunda"}\s+fase\b',norm(text)))
def is_exam(d):
    t=deaccent(d.first_text); return 'prova de conhecimentos gerais' in t and phase(d.first_text,1) and 'gabarito oficial' not in t
def is_key(d):
    t=f'{d.leaf}\n{d.first_text}'; n=deaccent(t)
    return 'gabarito' in n and not is_exam(d) and not (phase(t,2) and not phase(t,1)) and ('conhecimentos gerais' in n or phase(t,1) or 'grade definitiva de respostas' in n)
def gabarito_no(d):
    n=norm(d.first_text)
    for pat in (r'numero do gabarito(?: deste caderno de prova)?\s*(?:e)?\s*([1-4])\b',r'\bgabarito\s*([1-4])\b'):
        m=re.search(pat,n)
        if m:return int(m.group(1))
    return None
def expected(d):
    n=compact(deaccent(d.first_text)); m=re.search(r'(?:contem|contendo|com)\s+(\d{2,3})\s*(?:\([^)]*\)\s*)?quest',n)
    if m and 20<=int(m.group(1))<=120:return int(m.group(1))
    vals=[int(x) for x in re.findall(r'\b\d{1,3}\s*[-–]\s*(\d{2,3})\b',n)]
    return max(vals) if vals and 20<=max(vals)<=120 else None

def heading(line):
    n=norm(line)
    if len(n)>48:return None
    if n in SUBJECTS:return SUBJECTS[n]
    if n.startswith('lingua estrangeira'):
        for key in ('ingles','frances','espanhol'):
            if key in n:return SUBJECTS[key]
    return None
def context_marker(line):
    n=norm(line); return bool(re.match(r'^(?:texto|text)\s*(?:\d+|[ivxlcdm]+)?$',n) or re.match(r'^(?:texto|text)\s+para\s+(?:as\s+)?questoes\b',n))
def ignore(line):
    n=norm(line); return not n or n.startswith(('universidade estadual do ceara','comissao executiva do vestibular','o numero do gabarito deste caderno')) or re.match(r'^vestibular\s+20\d{2}',n) or re.match(r'^pagina\s+\d+$',n)

def parse_questions(pages,mode='plain'):
    out=[]; subj=label=None; active=''; pending=None; cur=None
    def finish():
        nonlocal cur
        if not cur:return
        out.append(Candidate(cur['n'],cur['s'],cur['l'],compact(' '.join(cur['st'])),cur['ctx'],{k:compact(' '.join(v)) for k,v in cur['a'].items()},cur['p'],mode)); cur=None
    for page_no,page in enumerate(pages,1):
        for raw in page.splitlines():
            line=compact(raw)
            if ignore(line):continue
            h=heading(line)
            if h: finish(); subj,label=h; active=''; pending=None; continue
            if context_marker(line): finish(); pending=[line]; continue
            q=Q_RE.match(line)
            if q and 1<=int(q.group(1))<=120:
                finish()
                if pending is not None: active=compact(' '.join(pending)); pending=None
                cur={'n':int(q.group(1)),'s':subj,'l':label,'st':[q.group(2)] if q.group(2) else [],'ctx':active,'a':{},'alt':None,'p':page_no}; continue
            if pending is not None: pending.append(line); continue
            if not cur:continue
            a=A_RE.match(line)
            if a:
                letter=(a.group(1) or a.group(2)).upper(); cur['a'].setdefault(letter,[]).append(a.group(3)); cur['alt']=letter
            elif cur['alt']: cur['a'].setdefault(cur['alt'],[]).append(line)
            else: cur['st'].append(line)
    finish(); return out

def doc_candidates(d):
    plain=parse_questions(base.pdf_pages(d,False),'plain'); e=expected(d) or 0
    if e and sum(x.complete for x in plain)>=e:return plain
    try:return plain+parse_questions(base.pdf_pages(d,True),'layout')
    except Exception:return plain

def choose_questions(cands,e):
    by={}
    for c in cands:
        if c.complete and 1<=c.number<=e:by.setdefault(c.number,[]).append(c)
    sel={}; missing=[]
    for n in range(1,e+1):
        items=by.get(n,[])
        if not items:missing.append(n);continue
        eng=[x for x in items if x.subject=='english']; lang=[x for x in items if x.subject in LANGS]
        if eng:pool=eng
        elif lang:
            pool=[x for x in items if x.subject not in LANGS]
            if not pool:missing.append(n);continue
        else:pool=items
        sel[n]=max(pool,key=lambda x:x.score)
    return sel,missing

def answer_tokens(line): return re.findall(r'(?<![A-Z])([A-DX])(?![A-Z])',line.upper())
def number_tokens(line): return [int(x) for x in re.findall(r'(?<!\d)(\d{1,3})(?!\d)',line) if 1<=int(x)<=120]
def parse_key_text(text,e=None):
    raw=[compact(x) for x in text.splitlines() if compact(x)]; nn=[norm(x) for x in raw]
    terms={'english':('lingua inglesa','ingles'),'french':('lingua francesa','frances'),'spanish':('lingua espanhola','espanhol')}
    starts=[i for i,x in enumerate(nn) if any(t in x for t in terms['english']) and len(x)<=96]
    if starts:
        s=starts[0]; z=len(raw)
        for i in range(s+1,len(nn)):
            if any(t in nn[i] for k,v in terms.items() if k!='english' for t in v) and len(nn[i])<=96:z=i;break
        raw,nn=raw[s:z],nn[s:z]
    elif any(t in ' '.join(nn) for k,v in terms.items() if k!='english' for t in v):return {}
    h=None
    for i,x in enumerate(nn):
        if any(int(m.group(1))==1 for m in KEY_HEAD.finditer(x)):h=i;break
    if h is None:return {}
    z=len(raw)
    for i in range(h+1,len(nn)):
        vals=[int(m.group(1)) for m in KEY_HEAD.finditer(nn[i])]
        if vals and any(v!=1 for v in vals):z=i;break
    block=raw[h+1:z]; ans={}; i=0
    while i<len(block):
        nums=number_tokens(block[i])
        if len(nums)<4:i+=1;continue
        toks=[];j=i+1
        while j<len(block) and len(toks)<len(nums) and j<=i+3:
            if len(number_tokens(block[j]))>=4 and not toks:break
            toks+=answer_tokens(block[j]);j+=1
        if len(toks)>=len(nums):
            for n,t in zip(nums,toks):
                if e is None or n<=e:ans[n]=None if t=='X' else t
            i=j
        else:i+=1
    return ans

def parse_key(d,e):
    text='\n'.join(base.pdf_pages(d,False)); a=parse_key_text(text,e); c=deaccent(f'{d.leaf}\n{text}')
    status='definitive' if 'definitiv' in c else 'preliminary' if ('preliminar' in c or 'provisor' in c) else 'unknown'
    return a,status

def scan(src):
    if not is_uece(src):return [],{'archive':src.path.name,'reason':'not-uece'},None
    try:docs=base.load_documents([src.path]);base.hydrate_pdf_metadata(docs)
    except Exception as ex:return [],{},str(ex)
    rel=[]
    for d in docs:
        if is_exam(d) or is_key(d):
            c=cycle(d.first_text,src)
            if all(c):rel.append((c,d))
    if not rel:return [],{'archive':src.path.name,'reason':'no-first-phase-objective-documents'},None
    b=src.path.read_bytes(); info={'name':src.path.name,'sha256':base.sha256(b),'bytes':len(b),'downloadId':src.meta.get('downloadId'),'title':src.title,'downloadUrl':src.meta.get('downloadUrl'),'resolvedDownloadUrl':src.meta.get('resolvedDownloadUrl')}
    return rel,info,None

def desc(d,blob=None):
    x={'archive':d.archive,'member':d.member,'sha256':d.sha256,'bytes':d.size,'pages':d.page_count}
    if blob:x['blob']=blob
    return x

def process_cycle(cyc,docs,sources,out):
    y,t=cyc; docs=list({d.sha256:d for d in docs}.values()); exams=[d for d in docs if is_exam(d)]; keys=[d for d in docs if is_key(d)]
    pe=[]
    for d in exams:
        if gabarito_no(d) not in (None,1):continue
        e=expected(d)
        if not e:continue
        q,m=choose_questions(doc_candidates(d),e);pe.append((len(q),-len(m),d.page_count,d,e,q))
    exam=max(pe,default=None,key=lambda x:x[:3]); e=exam[4] if exam else None
    pk=[]
    for d in keys:
        a,s=parse_key(d,e);pk.append((len(a),{'definitive':2,'preliminary':1,'unknown':0}[s],d,a,s))
    key=max(pk,default=None,key=lambda x:x[:2]); e=e or (max(key[3]) if key and key[3] else None)
    qmap=exam[5] if exam else {}; amap=key[3] if key else {}; questions=[]; mq=[];ma=[];review=0
    if e:
        for n in range(1,e+1):
            c=qmap.get(n)
            if not c:mq.append(n);continue
            if n not in amap:ma.append(n);continue
            vis=bool(VISUAL_RE.search(f'{c.context} {c.statement}'));review+=int(vis);a=amap[n]
            questions.append({'number':n,'subject':c.label or c.subject or 'Conhecimentos gerais','subjectId':c.subject,'statement':c.statement,'sharedContext':c.context or None,'alternatives':[{'id':x,'text':c.alts[x]} for x in LETTERS],'correctAlternative':a,'annulled':a is None,'page':c.page,'flags':['likely-visual-dependency'] if vis else []})
    issues=[]
    if not exams:issues.append('exam-document-not-found')
    elif not exam:issues.append('canonical-gabarito-1-exam-not-parseable')
    if not keys:issues.append('answer-key-document-not-found')
    elif not key or not key[3]:issues.append('canonical-english-gabarito-1-key-not-parseable')
    if not e:issues.append('expected-question-count-unknown')
    else:
        if len(qmap)!=e:issues.append(f'question-coverage:{len(qmap)}/{e}')
        if len(amap)!=e:issues.append(f'answer-key-coverage:{len(amap)}/{e}')
    if key and key[4]!='definitive':issues.append(f'answer-key-status:{key[4]}')
    if mq:issues.append('missing-questions:'+','.join(map(str,mq)))
    if ma:issues.append('missing-answers:'+','.join(map(str,ma)))
    blobs={}
    for d in ([exam[3]] if exam else [])+([key[2]] if key else []):blobs[d.sha256]=base.write_blob(out,d)
    complete=bool(e and len(questions)==e and len(qmap)==e and len(amap)==e); eid=f'uece-{y}.{t}'
    payload={'providerId':PROVIDER_ID,'institution':'UECE','editionId':eid,'year':y,'term':t,'parserVersion':PARSER_VERSION,'rightsStatus':RIGHTS_STATUS,'canonicalVariant':{'gabarito':1,'language':'english'},'sources':sources,'unit':{'id':'first-phase-general','label':'1ª fase - Conhecimentos Gerais','expectedQuestions':e or 0,'extractedQuestions':len(questions),'structurallyComplete':complete,'answerKeyStatus':key[4] if key else 'missing','questionsNeedingReview':review,'examDocument':desc(exam[3],blobs.get(exam[3].sha256)) if exam else None,'answerKeyDocument':desc(key[2],blobs.get(key[2].sha256)) if key else None,'issues':issues,'questions':questions},'summary':{'expectedQuestions':e or 0,'extractedQuestions':len(questions),'completeUnits':int(complete),'units':1,'questionsNeedingReview':review}}
    p=out/'uece'/f'{y}.{t}';p.mkdir(parents=True,exist_ok=True);(p/'bundle.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return payload

def run(paths,out,workers):
    src=[Source(p,sidecar(p)) for p in paths]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,workers)) as pool:r=list(pool.map(scan,src))
    groups={};sk=[];fail=[]
    for s,(rel,info,err) in zip(src,r):
        if err:fail.append({'archive':s.path.name,'error':err});continue
        if not rel:sk.append(info);continue
        cs=sorted({c for c,_ in rel})
        for c,d in rel:
            g=groups.setdefault(c,{'d':{},'s':{}});g['d'][d.sha256]=d; z=dict(info);z['cyclesDetected']=[f'{a}.{b}' for a,b in cs];g['s'][info['sha256']]=z
    ed=[process_cycle(c,list(g['d'].values()),list(g['s'].values()),out) for c,g in sorted(groups.items())]
    return ed,sk,fail

def main():
    ap=argparse.ArgumentParser(description='UECE first-phase fast lane for local/Brasil Escola ZIPs.');ap.add_argument('--input',action='append',default=[]);ap.add_argument('--output',default='.ingestion-cache/inbox');ap.add_argument('--workers',type=int,default=2);a=ap.parse_args()
    try:paths=inputs(a.input)
    except ValueError as e:print(e,file=sys.stderr);return 2
    if not paths:print('no ZIP files found',file=sys.stderr);return 2
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True);ed,sk,fail=run(paths,out,min(max(a.workers,1),4))
    summary={'version':1,'parserVersion':PARSER_VERSION,'providerId':PROVIDER_ID,'institution':'UECE','archivesScanned':len(paths),'skippedArchives':len(sk),'editions':len(ed),'expectedQuestions':sum(x['summary']['expectedQuestions'] for x in ed),'extractedQuestions':sum(x['summary']['extractedQuestions'] for x in ed),'completeEditions':sum(x['summary']['completeUnits'] for x in ed),'questionsNeedingReview':sum(x['summary']['questionsNeedingReview'] for x in ed),'cycles':[{'editionId':x['editionId'],'year':x['year'],'term':x['term'],**x['summary'],'answerKeyStatus':x['unit']['answerKeyStatus'],'issues':x['unit']['issues']} for x in ed],'skipped':sk,'failures':fail}
    (out/'uece-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,ensure_ascii=False,indent=2));return 1 if fail else 0
if __name__=='__main__':raise SystemExit(main())
