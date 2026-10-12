/** Read-only, allowlisted, on-demand Agent Skill library. Not arbitrary files. */
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

export const SKILL_CATALOG=Object.freeze({
  'agent-coordination':'Web/Local Main/Sub roles, Luna delegation, Tips communication and ACK/verify',
  'main-batch-triage':'Authorized urgent Local Sol wakes: triage passive inbox, delegate and report receipts',
  'research-safety':'AIR causal experiments, STOP, GPU/Owner locks and evidence validity',
  'tips-troubleshooting':'Unread mail, Main/Sub ACK, Web Wake and Tips diagnostics',
});

export function createTipsSkills(config,{root}={}){
  const allowed=(config.allowedRoots??[]).map(r=>resolve(r));
  const candidates=root?[resolve(root)]:allowed.flatMap(r=>[
    join(r,'tips','skills'),join(r,'devspace-tips-mcp','tips','skills'),
  ]);
  const directory=candidates.find(dir=>existsSync(join(dir,'agent-coordination','SKILL.md')));
  function run({action='list',name}={}){
    if(action==='list')return {skills:Object.entries(SKILL_CATALOG).map(([id,description])=>({name:id,description})),
      help:'tips_skills({action:"read",name:"main-batch-triage"}) to read one Skill on demand; no secret access'};
    if(action!=='read')throw Error('Unsupported Skill action');
    if(typeof name!=='string'||!Object.hasOwn(SKILL_CATALOG,name))throw Error('Unknown Skill name');
    if(!directory)throw Error('Skills not installed on this DevSpace workspace');
    const path=join(directory,name,'SKILL.md');
    if(!existsSync(path))throw Error('Skill not installed: '+name);
    const content=readFileSync(path,'utf8');
    if(content.length>18000)throw Error('Skill document too large');
    return {name,description:SKILL_CATALOG[name],content};
  }
  return {run};
}
