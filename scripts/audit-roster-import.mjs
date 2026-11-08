import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const C=[['hulk','ce63f355567040f598107c137fd60718'],['wonder_woman','80163d32bf8e4f1ba1ccf4746edaf82b'],['iron_man','dde1085c464d4f8da259fe6669ae4dd2'],['professor_x','2038ac61b7e245ea9be5f79ea0e0e9b7'],['green_lantern','89362a83a6834d068d05ee5c7589cf33'],['injustice_collection','e27284b707ec42aab42416ed39911d28'],['doctor_strange','f45da068ab5943d290de77eab4986ed6'],['goku_alt','43d3974194b5400e859bb794666f687e'],['saitama','94092067f03a47fe97f4575bd923e02e'],['light_yagami','7d0599365ae141f7b0b65cd55d27a06b'],['all_might','7deeb45392dc4bd18b478b28fa4a7c2b'],['edward_elric','7f7b988a9ef54535b485506279a1aa89'],['levi','01ffa989559941ef807cc07b3fed40b8'],['madara_a','ac94205c42a64acfbe4bcb0074d5dc80'],['madara_b','83e56a5dd37a4902b5887625a2e3905d'],['hashirama','52c192ab8cd24eeda270b1dbae2bc743'],['sasuke','eac52e1fd006488f801a914988f807c1'],['luigi','e7409153c3514456a2b578d0777a8595'],['mario','e209f43fbfa04572b1198cf94b37c225'],['kratos','ad37e8d6a2e44f8691bf2f2ab5bdbfa9'],['kratos_weapons','c0e8a61840d145098782fdb2ca2bf512'],['link','fe87f3906fac4c23867dd09b56b11d53'],['master_chief','18f5ee1d13904939971601055102c91b'],['thor','266488af3874414a8dfa9f488e738aed'],['aang','1e6dc80e72f74437a5604e3fb6ff3b54'],['harry_potter','250a590d181e4f6cb0aec4a0c55e293c'],['edna','230c623c1c574ddf8d28a659d0720dce'],['jack','8ab27af22d9842e28115b53aaae31151'],['spider_man','9a0393916dc54a4183543eef3ef08f83'],['spider_man_alt','ae006607e5f748359fc532634b2c61cf'],['iron_spider','99e52e57a8dc4feda750af87b87d2955'],['robot_police','36bc284bf5b84a6597db8f6db053c095']];
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const man=JSON.parse(readFileSync('public/models/characters/manifest.json','utf8'));
const main=readFileSync('public/js/main.js','utf8');
const b=main.match(/const roster=\[\[(.*?)\]\]/s);
const roster=b?[...b[1].matchAll(/\["([^"]+)","(\w+)"\]/g)].map(m=>({name:m[1],id:slug(m[1])})):[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=[];
for(const [key,uid] of C){
  let done=false;
  for(let a=0;a<3&&!done;a++){
    try{const r=await fetch(`https://api.sketchfab.com/v3/models/${uid}`,{headers:{accept:'application/json'}});
      if(r.status===429){await sleep(3000*(a+1));continue;}
      const j=await r.json();
      rows.push({key,uid,name:j.name,creator:j.user?.displayName,license:j.license?.label,downloadable:!!j.isDownloadable,rigged:!!j.isRigged,animations:j.animationCount??0,faces:j.faceCount??null,status:r.status});done=true;
    }catch(e){rows.push({key,uid,status:'ERR'});done=true;}
  }
  await sleep(300);
}
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/roster-import-audit.json',JSON.stringify({generatedAt:new Date().toISOString(),roster,manifest:Object.fromEntries(Object.entries(man.characters).map(([k,v])=>[k,{url:v.url,enabled:v.enabled,joints:v.verified?.joints??null,clips:v.verified?.clips??null}])),candidates:rows},null,1));
console.log('ROSTER',roster.length,'MANIFEST',Object.keys(man.characters).length);
for(const r of rows)console.log(r.key,r.downloadable?'DL':'NO-DL',r.rigged?'RIG':'UNRIGGED','anim='+r.animations,'faces='+r.faces,r.license||'?','|',r.name);
