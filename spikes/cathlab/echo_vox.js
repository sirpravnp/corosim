// ---------- echo: the real four-chamber CT-derived heart, cut by a TEE imaging plane ----------
// Anatomy: Rodero et al. 2021, "Linking statistical shape models and simulated function in the healthy adult human heart" (average shape), CC BY 4.0, Zenodo 10.5281/zenodo.4593739.
// Heart frame, cm: x lateral, y anterior, z toward the base; origin at the centre of the LV base, long axis along z.
const HJ=/*HEART_JSON*/null,HB64="/*HEART_B64*/";
const eco=$("echo"),E=eco.getContext("2d"),EW=eco.width,EH=eco.height,NPX=EW*EH,D2R=Math.PI/180;
const SEGS=["anteroseptal","anterior","anterolateral","inferolateral","inferior","inferoseptal"];
function gblur(arr,w,h,sx,sy,wrapX){
  const kern=s=>{const r=Math.max(1,Math.ceil(s*2.5)),K=[];let z=0;for(let i=-r;i<=r;i++){const v=Math.exp(-i*i/(2*s*s));K.push(v);z+=v}return [K.map(v=>v/z),r]};
  const [kx,rx]=kern(sx),[ky,ry]=kern(sy),tmp=new Float32Array(arr.length),out=new Float32Array(arr.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let a=0;for(let i=-rx;i<=rx;i++){let xx=x+i;xx=wrapX?(xx+w)%w:Math.min(w-1,Math.max(0,xx));a+=arr[y*w+xx]*kx[i+rx]}tmp[y*w+x]=a}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let a=0;for(let j=-ry;j<=ry;j++){const yy=Math.min(h-1,Math.max(0,y+j));a+=tmp[yy*w+x]*ky[j+ry]}out[y*w+x]=a}
  return out;
}
function lognorm(arr,k){let m=0,v=0;arr.forEach(x=>m+=x);m/=arr.length;arr.forEach(x=>v+=(x-m)**2);v=Math.sqrt(v/arr.length)||1;let z=0;const o=arr.map(x=>Math.exp(k*(x-m)/v));o.forEach(x=>z+=x);z/=o.length;return o.map(x=>x/z)}
const NRX=16,NU=720,TEX=(()=>{const n=new Float32Array(NU*NRX).map(()=>Math.random());return lognorm(gblur(n,NU,NRX,1.1,0.9,true),0.40)})();
const BG=(()=>{const n=new Float32Array(NPX).map(()=>Math.random());return lognorm(gblur(n,EW,EH,1.7,1.0,false),0.42)})();
const nrm=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l]};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],add=(a,b,k=1)=>[a[0]+k*b[0],a[1]+k*b[1],a[2]+k*b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
// ids shared with tools/fill2.py
const ID={LV:1,RV:2,RA:3,LA:4,LAA:5,LVOT:6,AOROOT:7,ASCAO:8,SVC:9,IVC:10,RVOT:11,DAO:12,LUPV:13,LLPV:14,RUPV:15,RLPV:16,PA:17,ARCH:18,MV:20,AV:21,TV:22,PV:23,IAS:24,RVW:25,LAW:26,RAW:27,AOW:28,PERI:29,PMAL:30,PMPM:31,VW:32,SEG:40};
const SEG17=[];["basal","mid"].forEach(l=>["anterolateral","anterior","anteroseptal","inferoseptal","inferior","inferolateral"].forEach(n=>SEG17.push(l+" "+n)));["apical anterior","apical septal","apical inferior","apical lateral","apex"].forEach(n=>SEG17.push(n));
const LABELS={1:["LV","c"],2:["RV","c"],3:["RA","c"],4:["LA","c"],5:["LAA","c"],6:["LVOT","c"],7:["Ao root","v"],8:["Asc Ao","v"],9:["SVC","v"],10:["IVC","v"],11:["RVOT","v"],12:["Desc Ao","v"],13:["LUPV","v"],14:["LLPV","v"],15:["RUPV","v"],16:["RLPV","v"],17:["PA","v"],18:["Aortic arch","v"],20:["MV","x"],21:["AV","x"],22:["TV","x"],23:["PV","x"],24:["IAS","w"],25:["RV free wall","w"],29:["Pericardium","w"],30:["AL papillary","w"],31:["PM papillary","w"]};
SEG17.forEach((n,i)=>LABELS[40+i]=[n,"s"]);
// ---- volume ----
let VOL=null,TRN=null,UQ=null,ZQ=null,NX=0,NY=0,NZ=0,LO=[0,0,0],heartReady=false,VIEWS={},UTAB=null;
const UT=[];
async function loadHeart(){
  const bin=Uint8Array.from(atob(HB64),c=>c.charCodeAt(0));
  const buf=await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const a=new Uint8Array(buf);[NX,NY,NZ]=HJ.shape;LO=HJ.origin_mm;const N=NX*NY*NZ;
  VOL=a.subarray(0,N);TRN=a.subarray(N,2*N);UQ=a.subarray(2*N,3*N);ZQ=a.subarray(3*N,4*N);UTAB=HJ.u_table;
  initAnatomy();initPoses();heartReady=true;
}
const vidx=(x,y,z)=>{const i=Math.round(x*10-LO[0]),j=Math.round(y*10-LO[1]),k=Math.round(z*10-LO[2]);return (i<0||j<0||k<0||i>=NX||j>=NY||k>=NZ)?-1:(i*NY+j)*NZ+k};
const isLV=id=>id===1||id===6||(id>=40&&id<57);
// ---- procedural continuations of the vessels the mesh cuts off, built from the mesh's landmarks ----
let CAPS=[],ARCHP=[],LVLEN=8.8,PMS=[];
const AOU=()=>nrm(HJ.tubes.ao.u);
function initAnatomy(){
  const T=HJ.tubes,O=HJ.ostia,u=AOU();
  CAPS=[];
  const cap=(id,p,d,L,r,w)=>{const e=add(p,d,L),c=add(p,d,L/2);CAPS.push({id,p,d,L,r,w,c,br:L/2+r+w+0.2})};
  [["SVC",ID.SVC,6.5,0.95],["IVC",ID.IVC,4.5,0.95],["LUPV",ID.LUPV,2.8,0.95],["LLPV",ID.LLPV,2.8,0.95],["RUPV",ID.RUPV,2.8,0.95],["RLPV",ID.RLPV,2.8,0.95],["LAA",ID.LAA,2.6,0.85]].forEach(([nm,id,L,f])=>{const o=O[nm];cap(id,add(o.c,o.n,-0.5),nrm(o.n),L,o.r*f,0.22)});
  const ep=T.ao.end;cap(ID.ASCAO,add(ep,u,-0.3),u,3.3,T.ao.r,0.25);
  cap(ID.PA,add(T.pa.end,nrm(T.pa.u),-0.3),nrm(T.pa.u),3.6,T.pa.r,0.22);
  // arch: planar semi-ellipse from the end of the ascending aorta to the top of the descending aorta, which runs behind the left atrium
  const E1=add(ep,u,3.0),LAc=HJ.centroids.LA;
  let laYmin=9;for(let i=0;i<NX;i+=2)for(let j=0;j<NY;j+=2)for(let k=0;k<NZ;k+=3){if(VOL[(i*NY+j)*NZ+k]===ID.LA){const y=(j+LO[1])/10;if(y<laYmin)laYmin=y}}
  const D0=[3.7,laYmin-2.6,LAc[2]];
  const Dtop=add(D0,u,dot(sub(E1,D0),u)),M=[(E1[0]+Dtop[0])/2,(E1[1]+Dtop[1])/2,(E1[2]+Dtop[2])/2],Hv=sub(Dtop,E1),H=Math.hypot(...Hv)/2,hh=Math.min(3.4,Math.max(2.2,H*0.9));
  ARCHP=[];for(let i=0;i<=20;i++){const f=i/20*Math.PI;ARCHP.push(add(add(M,Hv,-Math.cos(f)/2),u,Math.sin(f)*hh))}
  CAPS.push({id:ID.DAO,p:add(Dtop,u,-24),d:u,L:24,r:1.25,w:0.25,c:add(Dtop,u,-12),br:12+1.8});
  window.DESC={D0,Dtop,u,M,Hv,hh,E1};
  // LV length from the apex
  LVLEN=-HJ.lv_apex_cm[2];
  // papillary muscles: found on the endocardium at mid-level in the anterolateral and posteromedial positions
  PMS=[];
  [[ID.PMAL,150,-0.50],[ID.PMPM,-65,-0.52]].forEach(([id,uu,zf])=>{const z=-LVLEN*(1-zf-0.0);let best=0,bd=1e9;for(let b=0;b<72;b++){const d=Math.abs(((UTAB[b]-uu+540)%360)-180);if(d<bd){bd=d;best=b}}
    const psi=(best*5+2.5)*D2R;let rEnd=2;for(let r=0.2;r<5;r+=0.05){const ix=vidx(Math.cos(psi)*r,Math.sin(psi)*r,z);if(ix>=0&&VOL[ix]>=40&&VOL[ix]<57){rEnd=r;break}}
    PMS.push({id,psi,r:rEnd*0.78,z});});
}
// ---- ischemia by wall position (u = angle about the LV axis, 0 at the septum, + toward the anterior wall; zf = 0 at the apex .. 1 at the base) ----
function segSeverity(){
  const grp={LAD:[],LCX:[],RCA:[]};
  cs.allBeds.forEach(b=>{const g=/^(LAD|D1|D2)/.test(b.seg)?"LAD":/^(LCX|OM)/.test(b.seg)?"LCX":"RCA";grp[g].push(b.severity)});
  const m=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;return {LAD:m(grp.LAD),LCX:m(grp.LCX),RCA:m(grp.RCA)};
}
let SEV6=null,SEV4=null,SEVC=0,WORST=0,SEGSEV=new Float32Array(17);
const sstep=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x)};
function prepSev(){
  const S=segSeverity();WORST=Math.max(S.LAD,S.LCX,S.RCA);SEVC=S.LAD;
  const six=[[150,0.5*S.LAD+0.5*S.LCX],[90,S.LAD],[30,S.LAD],[-30,0.85*S.RCA+0.15*S.LAD],[-90,S.RCA],[-150,S.LCX]];
  const four=[[90,S.LAD],[0,S.LAD],[-90,0.5*S.LAD+0.5*S.RCA],[180,0.5*S.LAD+0.5*S.LCX]];
  const sm=(tab,kap)=>{const o=new Float32Array(361);for(let a=0;a<=360;a++){let w=0,v=0;tab.forEach(([c,s])=>{const k=Math.exp(kap*Math.cos((a-180-c)*D2R));w+=k;v+=k*s});o[a]=v/w}return o};
  SEV6=sm(six,6);SEV4=sm(four,5);
  // per-segment severity for the territory overlay
  for(let i=0;i<17;i++){if(i<12){const c=[150,90,30,-30,-90,-150][i%6],a=Math.round(c+180);SEGSEV[i]=SEV6[a]}else if(i<16){const c=[90,0,-90,180][i-12];SEGSEV[i]=SEV4[Math.round(c+180)]}else SEGSEV[i]=SEVC}
}
function sevAt(ui,zf){const t=sstep((0.40-zf)/0.15);let s=SEV6[ui]*(1-t)+SEV4[ui]*t;const c=sstep((0.14-zf)/0.08);return s*(1-c)+SEVC*c}
// ---- views: probe P, beam direction b, in-plane axes h0 (image right at 0 deg) and s0 (the plane turns toward it) ----
let curView=null,Xb=new Float32Array(NPX*3),Mk=new Uint8Array(NPX);
const SA=0.62,apxE=EW/2,apyE=-EH*0.02;
function basis(v,ang){const a=(ang==null?v.ang:ang)*D2R,b=nrm(v.b);let h=v.h,d=dot(h,b);h=nrm(sub(h,[b[0]*d,b[1]*d,b[2]*d]));let s=v.s;d=dot(s,b);s=nrm(sub(s,[b[0]*d,b[1]*d,b[2]*d]));
  return {b,hh:[Math.cos(a)*h[0]+Math.sin(a)*s[0],Math.cos(a)*h[1]+Math.sin(a)*s[1],Math.cos(a)*h[2]+Math.sin(a)*s[2]]}}
function setView(name,ang){
  const v=VIEWS[name];if(!v)return;curView=name;const {b,hh}=basis(v,ang);
  const ppc=(EH*0.97)/v.depth;
  for(let j=0;j<EH;j++)for(let i=0;i<EW;i++){const k=j*EW+i,xa=i-apxE,ya=j-apyE,rho=Math.hypot(xa,ya),ang2=Math.atan2(xa,ya);
    Mk[k]=(Math.abs(ang2)<SA&&rho>EH*0.02&&rho<EH*0.97)?1:0;const r=rho/ppc,c=Math.cos(ang2),sn=Math.sin(ang2);
    Xb[k*3]=v.P[0]+r*(c*b[0]+sn*hh[0]);Xb[k*3+1]=v.P[1]+r*(c*b[1]+sn*hh[1]);Xb[k*3+2]=v.P[2]+r*(c*b[2]+sn*hh[2])}
  const shown=ang==null?v.ang:ang;$("omni").value=Math.round(shown);$("omniv").textContent=Math.round(shown)+"°";
}
function initPoses(){
  const V=HJ.valves,O=HJ.ostia,T=HJ.tubes,C=HJ.centroids,z=[0,0,1],X=[1,0,0],Y=[0,1,0],u=AOU(),Dd=window.DESC;
  const planeCost=(P,b,v,pts)=>{const n=cross(b,v);return pts.reduce((s,q)=>s+Math.abs(dot(sub(q,P),n)),0)};
  const fit=(P,b,h0,s0,pts,lo=0,hi=180)=>{let best=lo,bc=1e9;const {b:bb}=basis({b,h:h0,s:s0,ang:0},0);for(let a=lo;a<=hi;a++){const {hh}=basis({b,h:h0,s:s0,ang:a});const c=planeCost(P,bb,hh,pts);if(c<bc){bc=c;best=a}}return best};
  // ME: probe on the LV long axis above the heart. The four-chamber plane holds the axis and the tricuspid centre; the tricuspid side is image-left.
  const tv=V.TV.c,h4=nrm([-tv[0],-tv[1],0]),s4=nrm(cross(z,h4)),sgn=dot(s4,Y)>=0?1:-1;
  const me=(off,ang,depth=16.8)=>({P:add([0,0,6.9],s4,off*sgn),b:[0,0,-1],h:h4,s:[s4[0]*sgn,s4[1]*sgn,s4[2]*sgn],ang,depth});
  const ca=V.AV.c,laxA=Math.round(((Math.atan2(dot(ca,[s4[0]*sgn,s4[1]*sgn,s4[2]*sgn]),dot(ca,h4))/D2R)+360)%180);
  VIEWS["ME four-chamber (0°)"]=me(0,0);
  VIEWS["ME five-chamber"]=me(1.6,0);
  VIEWS["ME mitral commissural (60°)"]=me(0,60);
  VIEWS["ME two-chamber (90°)"]=me(0,90);
  VIEWS["ME long-axis ("+laxA+"°)"]=me(0,laxA);
  // axial poses: a plane perpendicular to a vessel axis (angle 0) that turns into a long-axis plane at 90 degrees
  const axial=(pt,ax,bpref,leftRef,depth,ang=0,D=7)=>{let b=nrm(sub(bpref,[ax[0]*dot(bpref,ax),ax[1]*dot(bpref,ax),ax[2]*dot(bpref,ax)]));let h=nrm(cross(ax,b));if(leftRef&&dot(sub(leftRef,pt),h)>0)h=[-h[0],-h[1],-h[2]];return {P:add(pt,b,-D),b,h,s:ax,ang,depth}};
  const avN=nrm(V.AV.n);
  VIEWS["ME aortic valve short-axis"]=axial(V.AV.c,avN,Y,C.RA,11);
  VIEWS["ME aortic valve long-axis"]=axial(V.AV.c,avN,Y,C.RA,11,100);
  const asc=add(T.ao.end,u,1.2);
  VIEWS["ME ascending aortic short-axis"]=axial(asc,u,Y,C.RA,12);
  VIEWS["ME ascending aortic long-axis"]=axial(asc,u,Y,C.RA,12,90);
  { const a=axial(V.AV.c,avN,Y,C.RA,12);const ang=fit(a.P,a.b,a.h,a.s,[V.TV.c,V.PV.c]);VIEWS["ME RV inflow-outflow"]=Object.assign({},a,{ang}); }
  { const mid=[(O.SVC.c[0]+O.IVC.c[0])/2,(O.SVC.c[1]+O.IVC.c[1])/2,(O.SVC.c[2]+O.IVC.c[2])/2];const a=axial(mid,avN,Y,null,12);const ang=fit(a.P,a.b,a.h,a.s,[O.SVC.c,O.IVC.c]);VIEWS["ME bicaval"]=Object.assign({},a,{ang}); }
  { const mid=[(O.LAA.c[0]+O.LUPV.c[0])/2,(O.LAA.c[1]+O.LUPV.c[1])/2,(O.LAA.c[2]+O.LUPV.c[2])/2];const a=axial(mid,avN,Y,C.RA,11);const ang=fit(a.P,a.b,a.h,a.s,[O.LAA.c,O.LUPV.c]);VIEWS["ME LAA / left upper PV"]=Object.assign({},a,{ang}); }
  // TG: probe beyond the inferior wall, looking along the LV short axis
  const psiI=(()=>{let best=0,bd=1e9;for(let b=0;b<72;b++){const d=Math.abs(((UTAB[b]+90+540)%360)-180);if(d<bd){bd=d;best=b}}return (best*5+2.5)*D2R})();
  const psiS=(()=>{let best=0,bd=1e9;for(let b=0;b<72;b++){const d=Math.abs(((UTAB[b]+540)%360)-180);if(d<bd){bd=d;best=b}}return (best*5+2.5)*D2R})();
  const dI=[Math.cos(psiI),Math.sin(psiI),0],bT=[-dI[0],-dI[1],0],dS=[Math.cos(psiS),Math.sin(psiS),0];
  let hT=nrm(cross(z,bT));if(dot(hT,dS)>0)hT=[-hT[0],-hT[1],-hT[2]];       // septum on the image-left
  const tg=(zl,ang,depth=13)=>({P:add([0,0,zl],dI,10),b:bT,h:hT,s:z,ang,depth});
  VIEWS["TG basal short-axis"]=tg(-0.9,0);VIEWS["TG mid short-axis"]=tg(-LVLEN*0.5,0);VIEWS["TG apical short-axis"]=tg(-LVLEN*0.78,0);
  VIEWS["TG two-chamber"]=tg(-LVLEN*0.5,90,16);
  { const a=tg(-LVLEN*0.5,0,16),ang=fit(a.P,a.b,a.h,a.s,[V.AV.c],90,170);VIEWS["TG long-axis"]=Object.assign({},a,{ang}); }
  { // RV apex = lowest part of the RV cavity
    let zmin=9;for(let i=0;i<NX;i+=2)for(let j=0;j<NY;j+=2)for(let k=0;k<NZ;k+=2){if(VOL[(i*NY+j)*NZ+k]===ID.RV){const zz=(k+LO[2])/10;if(zz<zmin)zmin=zz}}
    let sx=0,sy=0,n=0;for(let i=0;i<NX;i+=2)for(let j=0;j<NY;j+=2)for(let k=0;k<NZ;k+=2){if(VOL[(i*NY+j)*NZ+k]===ID.RV&&(k+LO[2])/10<zmin+0.8){sx+=(i+LO[0])/10;sy+=(j+LO[1])/10;n++}}
    const rva=[sx/n,sy/n,zmin+0.4];const a=tg(-2.5,0,14);const P=add(add(rva,dI,10),z,0);const ang=fit(P,bT,hT,z,[V.TV.c,rva],0,180);VIEWS["TG RV inflow"]=Object.assign({},a,{P,ang}); }
  { const apex=[0,0,-LVLEN+0.3],bd=nrm(sub(ca,apex)),P=add(apex,bd,-3.0);VIEWS["Deep TG long-axis"]={P,b:bd,h:[1,0,0],s:Y,ang:0,depth:17}; }
  // thoracic aorta
  { const a=axial(Dd.D0,Dd.u,Y,null,8,0,4.5);VIEWS["Descending aorta short-axis"]=a;VIEWS["Descending aorta long-axis"]=Object.assign({},a,{ang:90}); }
  { const H=nrm(Dd.Hv),nA=nrm(cross(Dd.u,H)),Pa=add(add(Dd.M,H,-(Math.hypot(...Dd.Hv)/2+4)),nA,0),Tgt=add(Dd.M,Dd.u,Dd.hh*0.5),b=nrm(sub(Tgt,Pa));
    VIEWS["UE aortic arch long-axis"]={P:Pa,b,h:nrm(cross(nA,b)),s:nA,ang:0,depth:13};VIEWS["UE aortic arch short-axis"]={P:Pa,b,h:nrm(cross(nA,b)),s:nA,ang:90,depth:13}; }
  const sel=$("view");sel.innerHTML="";Object.keys(VIEWS).forEach(n=>{const o=document.createElement("option");o.textContent=n;sel.append(o)});
  setView(Object.keys(VIEWS)[0]);
}
// ---- one frame ----
const img0=E.createImageData(EW,EH),Ib=new Float32Array(NPX),Ik=new Uint8Array(NPX);
const stC=new Float32Array(64),stX=new Float32Array(64),stY=new Float32Array(64);
const BLOODID=new Uint8Array(64);[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].forEach(i=>BLOODID[i]=1);
const UPSTREAM={20:ID.LA,22:ID.RA,21:ID.LVOT,23:ID.RVOT};
function capHit(x,y,z){ // procedural vessels: returns [id, inLumen]
  for(let q=0;q<CAPS.length;q++){const c=CAPS[q];const cx=x-c.c[0],cy=y-c.c[1],cz=z-c.c[2];if(cx*cx+cy*cy+cz*cz>c.br*c.br)continue;
    const vx=x-c.p[0],vy=y-c.p[1],vz=z-c.p[2];let t=vx*c.d[0]+vy*c.d[1]+vz*c.d[2];t=t<0?0:t>c.L?c.L:t;
    const d=Math.hypot(vx-t*c.d[0],vy-t*c.d[1],vz-t*c.d[2]);if(d<c.r)return [c.id,true];if(d<c.r+c.w)return [ID.VW,false]}
  const ap=ARCHP;if(z>2){for(let i=0;i<ap.length-1;i++){const a=ap[i],b=ap[i+1],ex=b[0]-a[0],ey=b[1]-a[1],ez=b[2]-a[2],L2=ex*ex+ey*ey+ez*ez;let t=((x-a[0])*ex+(y-a[1])*ey+(z-a[2])*ez)/L2;t=t<0?0:t>1?1:t;const d=Math.hypot(x-a[0]-t*ex,y-a[1]-t*ey,z-a[2]-t*ez);if(d<1.35)return [ID.ARCH,true];if(d<1.6)return [ID.VW,false]}}
  return null;
}
function drawEcho(now){
  if(!heartReady||!curView)return;
  const hr=cs.hr||75,beat=((now/1000)*hr/60)%1;
  const sys=beat<0.36?Math.sin(beat/0.36*Math.PI*0.5)**1.3:Math.cos((beat-0.36)/0.64*Math.PI*0.5)**2;
  const mvOpen=beat>0.40,tvOpen=mvOpen,avOpen=beat>0.04&&beat<0.36,show=$("terr").checked;
  const gShort=0.30*Math.min(1,Math.max(0.35,cs.ef/0.6)),tf=Math.floor(now/70);stC.fill(0);stX.fill(0);stY.fill(0);
  const V=HJ.valves,vlv=[["MV",mvOpen],["TV",tvOpen],["AV",avOpen],["PV",avOpen]];
  for(let k=0;k<NPX;k++){
    if(!Mk[k]){Ik[k]=255;Ib[k]=0;continue}
    const x=Xb[k*3],y=Xb[k*3+1],z=Xb[k*3+2],bg=BG[(k+tf*7919)%NPX];
    let id=0,I=0.11*(0.55+0.7*bg),vi=-1,rx=x,ry=y,rz=z,mm=0,r0=0;
    // left ventricle: sample the end-diastolic volume at the reference position of this point
    const r2=x*x+y*y;
    if(r2<20&&z<0.7&&z>-LVLEN-1){
      const r=Math.sqrt(r2),psi=Math.atan2(y,x);let pd=psi/D2R;if(pd<0)pd+=360;const ui=Math.round(UTAB[Math.min(71,(pd/5)|0)]+180),zf=Math.max(0,Math.min(1,(z+LVLEN)/LVLEN));
      const sv=sevAt(Math.min(360,Math.max(0,ui)),zf);mm=sys*gShort*(1-0.96*sv)*(1+0.22*(1-sv)*WORST);
      const cp=Math.cos(psi),sp=Math.sin(psi);let w=1;
      for(let it=0;it<2;it++){r0=r/(1-mm*w);const z0=z/(1-0.3*mm),j=vidx(cp*r0,sp*r0,z0);
        if(j>=0&&isLV(VOL[j])){vi=j;rx=cp*r0;ry=sp*r0;rz=z0;const rho=TRN[j]/254;w=VOL[j]>=40?1-0.55*(rho>1?0:rho):1}else{vi=-1;break}}
    }
    if(vi<0){vi=vidx(x,y,z);rx=x;ry=y;rz=z}
    id=vi>=0?VOL[vi]:0;
    // valve leaflets
    let leaf=0;
    for(let q=0;q<4;q++){const nm=vlv[q][0],open=vlv[q][1],Vv=V[nm],ox=x-Vv.c[0],oy=y-Vv.c[1],oz=z-Vv.c[2];
      if(Math.abs(ox)>Vv.R+0.6||Math.abs(oy)>Vv.R+0.6||Math.abs(oz)>Vv.R+1.5)continue;
      const h=ox*Vv.n[0]+oy*Vv.n[1]+oz*Vv.n[2],px=ox-h*Vv.n[0],py=oy-h*Vv.n[1],pz=oz-h*Vv.n[2],rho=Math.hypot(px,py,pz);
      if(nm==="MV"||nm==="TV"){if(open&&h>0&&h<1.2&&Math.abs(rho-Vv.R*0.95*(1-0.62*h/1.2))<0.09){leaf=ID[nm];break}}
      else if(open&&h>0&&h<0.9&&Math.abs(rho-Vv.R*1.0)<0.08){leaf=ID[nm];break}}
    if(leaf){id=leaf;I=0.62+0.2*bg}
    else if(id>=20&&id<=23){ // valve plane: shown while closed, blood while open
      const open=id===ID.MV?mvOpen:id===ID.TV?tvOpen:avOpen;if(open){id=UPSTREAM[id];I=0.02+0.04*bg*bg}else I=0.62+0.2*bg}
    else if(id===0||id===29){const hit=capHit(x,y,z);if(hit){id=hit[0];I=hit[1]?0.02+0.04*bg*bg:0.28*(0.6+0.8*bg)}else if(id===29)I=0.38*(0.6+0.8*bg)}
    else if(BLOODID[id])I=0.02+0.04*bg*bg;
    else if(id>=40&&id<57){const f=Math.min(NRX-1,(TRN[vi]/254*NRX)|0),uu=(UQ[vi]*2.83+ZQ[vi]*5)|0;I=0.21*TEX[f*NU+((uu%NU)+NU)%NU]}
    else if(id===ID.IAS)I=0.34*(0.6+0.8*bg);else if(id===ID.RVW)I=0.26*(0.6+0.8*bg);else if(id===ID.LAW||id===ID.RAW)I=0.22*(0.6+0.8*bg);else if(id===ID.AOW||id===ID.VW)I=0.28*(0.6+0.8*bg);
    // papillary muscles ride with the contracting wall
    if(id===ID.LV&&mm>=0){for(let q=0;q<2;q++){const p=PMS[q],cx0=Math.cos(p.psi)*p.r,cy0=Math.sin(p.psi)*p.r,dx=rx-cx0,dy=ry-cy0,dz=rz-p.z;
      const rad=(dx*Math.cos(p.psi)+dy*Math.sin(p.psi)),tan=(-dx*Math.sin(p.psi)+dy*Math.cos(p.psi));if((rad*rad)/0.30+(tan*tan)/0.30+(dz*dz)/1.5<1){id=p.id;I=0.26*(0.6+0.8*bg)}}}
    Ib[k]=I;Ik[k]=id;
  }
  // axial edge enhancement, depth gain, sector falloff
  const o=img0.data;
  for(let j=0;j<EH;j++)for(let i=0;i<EW;i++){
    const k=j*EW+i,p=k*4;
    if(!Mk[k]){o[p]=o[p+1]=o[p+2]=0;o[p+3]=255;continue}
    const up=j>0?Ib[k-EW]:Ib[k],dn=j<EH-1?Ib[k+EW]:Ib[k];let I=Ib[k]+0.32*Math.abs(dn-up);
    const depth=Math.hypot(i-apxE,j-apyE)/EH;I*=(0.6+0.9*depth)*(1-Math.pow(Math.abs(Math.atan2(i-apxE,j-apyE))/SA,7)*0.8);
    const id=Ik[k];if(id>0&&id<64){stC[id]++;stX[id]+=i;stY[id]+=j}
    const v=Math.pow(Math.min(1,Math.max(0,I)),0.82)*255;let r=v,g=v,b=v*1.03;
    if(show&&id>=40&&id<57){const t=Math.min(1,SEGSEV[id-40]*1.6),al=0.34;r=r*(1-al)+(70+185*t)*al;g=g*(1-al)+(200-130*t)*al;b=b*(1-al)+(110-60*t)*al}
    o[p]=r;o[p+1]=g;o[p+2]=b;o[p+3]=255;
  }
  E.putImageData(img0,0,0);
  E.fillStyle="rgba(235,235,225,.85)";E.font="13px ui-monospace,Menlo,monospace";
  E.fillText(curView.replace(/ \(.*\)/,"")+"  "+$("omni").value+"°",14,24);E.fillText("HR "+hr+"  EF "+Math.round(cs.ef*100)+"%",14,EH-14);
  if($("lab").checked)drawEchoLabels();
}
function drawEchoLabels(){
  const best={};for(let j=0;j<EH;j+=3)for(let i=0;i<EW;i+=3){const k=j*EW+i,id=Ik[k];if(id<1||id>=64||!stC[id])continue;const cx=stX[id]/stC[id],cy=stY[id]/stC[id],d=(i-cx)**2+(j-cy)**2;if(!best[id]||d<best[id][0])best[id]=[d,i,j]}
  const col={c:"#8fd3ff",v:"#9be39b",x:"#ffe27a",w:"#ffb27a",s:"#ffb27a"};
  E.font="12px system-ui,sans-serif";E.textBaseline="middle";const used=[];
  const order=Object.keys(best).map(Number).sort((a,b)=>(stC[b]*(LABELS[b]&&LABELS[b][1]==="x"?6:1))-(stC[a]*(LABELS[a]&&LABELS[a][1]==="x"?6:1)));
  for(const id of order){const L=LABELS[id];if(!L)continue;const minPx=L[1]==="x"||L[1]==="w"?18:90;if(stC[id]<minPx)continue;
    const [,x,y]=best[id],w=E.measureText(L[0]).width+6,rx=x-w/2,ry=y-8;
    if(rx<2||rx+w>EW-2)continue;if(used.some(u=>rx<u[0]+u[2]&&rx+w>u[0]&&ry<u[1]+u[3]&&ry+16>u[1]))continue;used.push([rx,ry,w,16]);
    E.fillStyle="rgba(0,0,0,.55)";E.fillRect(rx,ry,w,16);E.fillStyle=col[L[1]];E.fillText(L[0],rx+3,y)}
}
function stats(){
  const S=segSeverity(),bad=[];if(S.LAD>0.3)bad.push("LAD territory");if(S.LCX>0.3)bad.push("circumflex territory");if(S.RCA>0.3)bad.push("RCA territory");
  $("echostat").innerHTML=`<div><span>EF</span> <b class="${cs.ef<0.5?'bad':''}">${Math.round(cs.ef*100)}%</b></div><div><span>Hypo/akinetic</span> <b class="${bad.length?'bad':''}">${bad.length?bad.join(", "):"none"}</b></div>`;
}
