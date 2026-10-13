import { createServer, type AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { SmtpTransport } from '../src/integrations/mail';

it('sends an actual SMTP message to an isolated loopback server and retains its message ID',async()=>{
  let received='';
  const server=createServer(socket=>{
    socket.write('220 isolated.test SMTP ready\r\n');
    let buffer='',inData=false;
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      while(buffer.includes('\r\n')){
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(inData){if(line==='.'){inData=false;socket.write('250 2.0.0 queued isolated-id\r\n');}else received+=line+'\r\n';continue;}
        if(line.startsWith('EHLO'))socket.write('250-isolated.test\r\n250 SIZE 5000000\r\n');
        else if(line==='DATA'){inData=true;socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');}
        else if(line==='QUIT'){socket.end('221 Bye\r\n');}
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const adapter=new SmtpTransport({host:'127.0.0.1',port:(server.address() as AddressInfo).port,secure:false,from:'operations@example.test'});
    const result=await adapter.send({id:'isolated-message',recipient:'recipient@example.test',sender:'operations@example.test',subject:'Isolated SMTP acceptance',text:'No external recipient is contacted.'});
    expect(result.messageId).toBe('<isolated-message@syntherisk.local>');expect(received).toContain('To: recipient@example.test');expect(received).toContain('No external recipient is contacted.');expect(received).toContain('X-Syntherisk-Message: isolated-message');
    const {richTextValue}=await import('../src/lib/rich-text');received='';
    await adapter.send({id:'rich-message',recipient:'recipient@example.test',sender:'operations@example.test',subject:'Rich local test',text:richTextValue('<b>Formatted</b><img src="data:image/png;base64,aGVsbG8=" alt="Fixture">')});
    expect(received).toContain('Content-Type: text/html');expect(received).toContain('Content-Type: image/png');expect(received).toContain('Content-ID:');expect(received).not.toContain('syntherisk-rich:v1');
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},10000);
