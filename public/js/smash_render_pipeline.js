// Cinematic PBR renderer: physical reflections, tone mapping and controlled highlight bloom.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/ShaderPass.js';
export function createSmashRenderPipeline(canvas,scene){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
 renderer.setSize(window.innerWidth,window.innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.12;
 renderer.setClearColor(0x111b30,1);
 renderer.shadowMap.enabled=true;
 renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.info.autoReset=true;
 const camera=new THREE.PerspectiveCamera(49,window.innerWidth/window.innerHeight,.1,650);
 camera.position.set(0,12,18);
 const composer=new EffectComposer(renderer);
 composer.addPass(new RenderPass(scene,camera));
 const bloom=new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),.58,.68,.82);
 composer.addPass(bloom);
 // OutputPass ships in newer Three.js examples, not pinned r152. Use the same shader chunks on r152.
 composer.addPass(new ShaderPass({
  uniforms:{tDiffuse:{value:null}},
  vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform sampler2D tDiffuse; varying vec2 vUv;
   #include <tonemapping_pars_fragment>
   #include <encodings_pars_fragment>
   void main(){gl_FragColor=texture2D(tDiffuse,vUv);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
   }`
 }));
 return {renderer,camera,composer,bloom,enableSSR(){return null;}};
}
function makeDetailNormalTexture(){const size=256,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;const ripple=Math.sin(x*.21+Math.sin(y*.09)*2)*.18+Math.cos(y*.17+x*.03)*.13+Math.sin(x*.055)*Math.cos(y*.065)*.12;const crack=((x%64<2||y%64<2)?-.16:0);data[i]=128+(ripple+crack)*100;data[i+1]=128+Math.cos(x*.16+y*.23)*16;data[i+2]=246;data[i+3]=255;}const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(18,12);texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;return texture;}
function makeStoneAlbedoTexture(){const size=256,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;const tileEdge=(x%64<2||y%64<2)?-.24:0;const grain=Math.sin(x*.13+y*.07)*.035+Math.sin(y*.27-x*.09)*.025+Math.cos(x*.04+y*.12)*.025;const v=Math.max(.25,Math.min(1,.68+tileEdge+grain));data[i]=Math.round(160*v);data[i+1]=Math.round(174*v);data[i+2]=Math.round(190*v);data[i+3]=255;}const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(9,6);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;}
export function createWetStoneMaterial(color=0x303b47){return new THREE.MeshStandardMaterial({color,map:makeStoneAlbedoTexture(),metalness:.26,roughness:.24,normalMap:makeDetailNormalTexture(),normalScale:new THREE.Vector2(.3,.3)});}
