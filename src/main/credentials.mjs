import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
export class CredentialVault {
  constructor(path,storage){Object.assign(this,{path,storage});}
  async save(credentials){
    if(!await this.storage.isAsyncEncryptionAvailable())throw new Error('CREDENTIAL_STORAGE_UNAVAILABLE');
    const encrypted=await this.storage.encryptStringAsync(JSON.stringify(credentials));
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    await writeFile(this.path+'.tmp',encrypted,{mode:0o600});await rename(this.path+'.tmp',this.path);
  }
  async load(){
    let bytes;try{bytes=await readFile(this.path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!await this.storage.isAsyncEncryptionAvailable())throw new Error('CREDENTIAL_STORAGE_UNAVAILABLE');
    const {result,shouldReEncrypt}=await this.storage.decryptStringAsync(bytes);
    const value=JSON.parse(result);if(typeof value?.accessToken!=='string'||!value.accessToken)throw new Error('CREDENTIAL_INVALID');
    if(shouldReEncrypt)await this.save(value);return value;
  }
  async remove(){await rm(this.path,{force:true});}
}
