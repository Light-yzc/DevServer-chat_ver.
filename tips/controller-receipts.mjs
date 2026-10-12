/** Acks and closes Local Main messages WITHOUT creating new Sol turns.
 * Correct for both tracked (formal verify) and untracked (resolve) mail. */
export function finalizeMainMessage(tips,message,{verdict='accepted',note='' }={}){
  if(message?.to!=='server-controller')throw Error('Not a Local Main message');
  return tips.messages({action:'finalize_controller',id:message.id,verdict,note},{trustedWake:true});
}
