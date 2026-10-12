type ApiResult={data?:unknown;error?:{message?:string}};

export async function readAdminResponse(response:Response):Promise<unknown>{
  const text=await response.text();let result:ApiResult|null=null;
  try{result=text?JSON.parse(text) as ApiResult:null;}catch{
    if(!response.ok)throw new Error(`API mengembalikan respons yang tidak valid (HTTP ${response.status}). Pastikan API dan PostgreSQL berjalan; periksa terminal API untuk detail.`);
    throw new Error('API mengembalikan respons yang tidak valid.');
  }
  if(!response.ok)throw new Error(result?.error?.message??`Permintaan gagal (HTTP ${response.status}).`);
  if(!result||typeof result!=='object')throw new Error('Format respons API tidak valid.');
  return result.data;
}
