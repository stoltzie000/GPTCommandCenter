const MAX_REQUEST_BODY_BYTES=1024*1024;

export async function requestBody(req:AsyncIterable<Buffer|string>):Promise<any>{
  let raw='';let size=0;
  for await(const c of req){
    const chunk=typeof c==='string'?Buffer.from(c):Buffer.from(c);
    size+=chunk.byteLength;
    if(size>MAX_REQUEST_BODY_BYTES)throw new Error('REQUEST_TOO_LARGE');
    raw+=chunk.toString('utf8');
  }
  try{return JSON.parse(raw);}catch{throw new Error('INVALID_REQUEST');}
}

export { MAX_REQUEST_BODY_BYTES };
