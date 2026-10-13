/** Read-only, token-bounded Tips overview for agent research turns.
 * Data comes from the SAME Tips snapshot rendered on /tips; no model call,
 * HTTP request or mutation. Agents must open relevant task IDs for evidence. */
const ACTIVE=new Set(['running','pending','blocked','failed','paused']);
const RESEARCH=t=>/^(AIR|Subagents|Agent handoffs|Infrastructure)/i.test(t.group??'')||
  /^(sub-air-|air-|web-handoff-|tips-research-)/i.test(t.id??'');
const severity={running:0,failed:1,blocked:2,pending:3,paused:4};
const age=at=>{const ms=Date.parse(at??'');return Number.isFinite(ms)?ms:0;};
const clip=(value,max=78)=>String(value??'').replace(/\s+/g,' ').slice(0,max);

export function taskBoardDigest(snapshot,{role='main',agentId='',limit=12}={}){
  const tasks=(snapshot?.tasks??[]).filter(t=>t&&!t.archived&&ACTIVE.has(t.status)&&RESEARCH(t));
  const metrics={running:0,blocked:0,failed:0,pending:0,paused:0,stale:0};
  for(const t of tasks){metrics[t.status]++;if(t.health==='stale')metrics.stale++;}
  let selected=[];
  if(role==='sub'){
    const own=tasks.find(t=>t.id===agentId);
    if(own)selected.push(own);
    const dependencies=new Set(own?.dependsOn??own?.dependencyIds??[]);
    for(const t of tasks.filter(t=>dependencies.has(t.id)).slice(0,Math.max(0,limit-selected.length)))selected.push(t);
  }else{
    // Cross-group selection rather than the old AIR-LIFE-only last-15 slice.
    // Encourage diverse research visibility without dragging 97 task cards
    // into the same Sol Turn. This is task discovery, NOT an execution order.
    const groups=new Map();
    for(const t of tasks){const g=t.group??'Other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(t);}
    for(const items of groups.values())items.sort((a,b)=>{
      const urgency=t=>t.health==='stale'?-1:(severity[t.status]??8);
      return urgency(a)-urgency(b)||age(b.updatedAt)-age(a.updatedAt);
    });
    const ordered=[...groups.values()].sort((a,b)=>age(b[0]?.updatedAt)-age(a[0]?.updatedAt));
    while(selected.length<limit){
      let found=false;
      for(const items of ordered){if(selected.length>=limit)break;if(items.length){selected.push(items.shift());found=true}}
      if(!found)break;
    }
  }
  const counts=`running=${metrics.running}, blocked=${metrics.blocked}, failed=${metrics.failed}, pending=${metrics.pending}, paused=${metrics.paused}, stale=${metrics.stale}`;
  const intro=role==='sub'?`YOUR TIPS TASK CARD (read-only; ${counts} research tasks globally)`:
    `TIPS RESEARCH TASK OVERVIEW (across ALL groups; ${counts}; ${selected.length}/${tasks.length} shown)`;
  const lines=selected.map(t=>{
    const warn=t.health==='stale'?' STALE':t.status==='blocked'?' NO-GO until gate checked':'';
    const measured=t.progressMeasured===true?` ${t.progress}%`:'';
    const owner=t.owner?` owner=${clip(t.owner,28)}`:' OWNER_MISSING';
    const next=t.nextAction?` next=${clip(t.nextAction,50)}`:' NEXT_ACTION_MISSING';
    return `- ${clip(t.id,72)} [${clip(t.group,22)} / ${t.status}${warn}${measured}]${owner}${next}; ${clip(t.message,45)}`;
  });
  return [intro,...(lines.length?lines:['- No directly relevant open task card']),
    role==='sub'?'Update your OWN task card at verified milestones.':
    'This is a queue INDEX, not permission to run. Before dispatch, inspect full task by ID, current Owner, evidence, STOP/GPU/dispatch_hold, and existing agents. Do not restart BLOCKED tasks without approval.'
  ].join('\n');
}
