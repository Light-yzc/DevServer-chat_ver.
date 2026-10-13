import {MAX_TIPS_TASK_MESSAGE_LENGTH} from '../vendor/devspace/dist/tips-core.js';

/** Store as much of the original scientific result as fits the shared task
 * message, and link to the complete per-turn result in the durable agent log.
 * Never truncate the actual result file; only the Tips presentation field. */
export function boundedTaskMessage(value,{sourcePath='',max=MAX_TIPS_TASK_MESSAGE_LENGTH}={}){
  const text=String(value??'');
  if(text.length<=max)return text;
  const suffix=sourcePath?`\n\n[显示已截断；完整结果：${sourcePath}]`:'\n\n[显示已截断]';
  if(suffix.length>=max)throw Error('Result reference exceeds task message limit');
  const visible=max-suffix.length;
  // Do not split a UTF-16 surrogate pair when truncating.
  let segment=text.slice(0,visible);
  if(segment.length&&/^[\uD800-\uDBFF]$/.test(segment.at(-1)))segment=segment.slice(0,-1);
  return segment+suffix;
}
