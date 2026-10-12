const baseUrl=()=>process.env.API_BASE_URL??'http://localhost:4000';

export class PublicApiError extends Error {
  constructor(message:string,readonly status:number){super(message);this.name='PublicApiError';}
}

export async function apiData<T>(path:string):Promise<T>{
 const response=await fetch(`${baseUrl()}${path}`,{cache:'no-store',headers:{accept:'application/json'}});
 const payload=await response.json() as {data?:T;error?:{message?:string}};
 if(!response.ok||payload.data===undefined)throw new PublicApiError(payload.error?.message??'Layanan sedang tidak tersedia.',response.status);
 return payload.data;
}

export type PublicImage={id:string;url:string|null;alt_text?:string|null};
export type Article={id:string;title:string;slug:string;excerpt:string|null;content?:string;published_at:string;category?:string|null;author?:string;tags?:Array<{id:string;name:string;slug:string}>;divisions?:Array<{id:string;name:string;slug:string}>;thumbnail?:PublicImage|null;images?:PublicImage[];comments?:Array<{id:string;name:string;content:string;created_at:string}>};
export type RentalItem={id:string;name:string;slug:string;description:string;price_per_performance?:number|string;price_per_unit_per_day?:number|string;total_quantity?:number;category_id?:string;category?:string;image_url?:string|null;image_alt?:string|null;image_media_id?:string|null};
export type SiteConfig={organization:{name:string;description:string;address?:string|null;phone?:string|null;email?:string|null}|null;manager_whatsapp:string|null;social_links:Record<string,string>};
