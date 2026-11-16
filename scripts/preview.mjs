import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../docs/',import.meta.url));
const base='/fitme-market-research/';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.gz':'application/gzip','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async (req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path==='/') {res.writeHead(302,{Location:base});res.end();return;}
    if(!path.startsWith(base)) {res.writeHead(404);res.end('Not found');return;}
    let file=resolve(root,path.slice(base.length)||'index.html');
    if(!file.startsWith(resolve(root)+sep)) {res.writeHead(403);res.end();return;}
    if((await stat(file)).isDirectory()) file=resolve(file,'index.html');
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'+base));
