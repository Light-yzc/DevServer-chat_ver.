/** Model-free read-only coordination audit. No job starts, gate changes or
 * automatic edits to scientific cards. Does not treat stale Tips status as
 * proof that a non-Sub experiment process has stopped. */
const TERMINAL=new Set(['completed','failed','stopped','interrupted']);
const ACTIVE=new Set(['running','pending']);
const ms=s=>{const n=Date.parse(s??'');return Number.isFinite(n)?n:0};
const age=(s,now)=>ms(s)?Math.max(0,now-ms(s)):null;
export function coordinationAudit({tasks=[],agents=[]},{now=Date.now(),staleAfterMs=20*60_000}={}){
  const byName=new Map(agents.map(a=>[a.name,a]));
  const stale=[],mismatched=[],unassigned=[],gateSignals=[];
  for(const task of tasks){
    const updatedMs=age(task.updatedAt,now);
    const isActive=ACTIVE.has(task.status);
    const agent=task.id?.startsWith('sub-')?byName.get(task.id):null;
    if(agent&&isActive&&TERMINAL.has(agent.status)){
      mismatched.push({id:task.id,boardStatus:task.status,agentStatus:agent.status,
        jobId:agent.jobId??null,next:'Inspect registry Job and actual logs; update the task card only after verification.'});
    }else if(isActive&&updatedMs!==null&&updatedMs>=staleAfterMs){
      stale.push({id:task.id,boardStatus:task.status,updatedMinutes:Math.floor(updatedMs/60000),
        knownAgentStatus:agent?.status??null,
        next:'Verify live process and owner; stale timestamp is NOT proof the process stopped.'});
    }
    if(['running','pending','blocked','failed'].includes(task.status)&&
       (!task.owner||!task.nextAction)){
      unassigned.push({id:task.id,missingOwner:!task.owner,missingNextAction:!task.nextAction});
    }
    if(task.status==='paused'&&/全部停止|停止全部|stop\s+all|STOP_SCOPE|NO_NEW_GPU|dispatch_hold/i
      .test([task.message,task.nextAction,task.gate].filter(Boolean).join(' '))){
      gateSignals.push({id:task.id,updatedAt:task.updatedAt,
        note:'Possible standing STOP signal; only explicit newer Owner authorization can change it.'});
    }
  }
  return {at:new Date(now).toISOString(),readOnly:true,
    counts:{tasks:tasks.length,agents:agents.length,stale:stale.length,
      mismatched:mismatched.length,unassigned:unassigned.length,gateSignals:gateSignals.length},
    stopSignals:gateSignals.slice(0,20),
    mismatched:mismatched.slice(0,40),stale:stale.slice(0,40),unassigned:unassigned.slice(0,40),
    note:'Read-only advisory only. Never auto-resume experimental work or clear STOP/GPU/Owner locks from this report.'};
}
