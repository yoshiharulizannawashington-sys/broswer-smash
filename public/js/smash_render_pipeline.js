// Reliable renderer entrypoint. Avoid addon imports with unresolved bare module specifiers.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
export function createSmashRenderPipeline(canvas, scene) {
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.setSize(window.innerWidth,window.innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const camera=new THREE.PerspectiveCamera(49,window.innerWidth/window.innerHeight,.1,500);camera.position.set(0,12,18);
 const bloom={strength:.4,setSize(){}};
 return {renderer,camera,composer:{render(){renderer.render(scene,camera)},setSize(){}},bloom,enableSSR(){return null}};
}
function makeDetailNormalTexture(){const size=128,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;const ripple=Math.sin(x*.37+Math.sin(y*.18)*2)*.22+Math.cos(y*.31)*.16;data[i]=128+ripple*65;data[i+1]=128+Math.cos(x*.22+y*.27)*18;data[i+2]=246;data[i+3]=255;}const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(18,12);texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;return texture;}
export function createWetStoneMaterial(color=0x303b47){return new THREE.MeshStandardMaterial({color,metalness:.32,roughness:.2,normalMap:makeDetailNormalTexture(),normalScale:new THREE.Vector2(.22,.22)});}
