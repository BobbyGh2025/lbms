import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";

export async function GET(req: NextRequest,{params}:{params:Promise<{id:string}>}) {
  const auth=await authorize("documents","view"); if(!auth.ok)return auth.response;
  const {id}=await params;
  const doc=await db.document.findFirst({where:{id,...notDeleted()},select:{id:true,documentNumber:true,title:true,category:true,description:true,fileName:true,mimeType:true,fileSize:true,fileData:true,externalUrl:true,entityType:true,entityId:true,status:true,createdAt:true}});
  if(!doc)return notFound("Document not found.");
  if(req.nextUrl.searchParams.get("download")==="1"){
    if(doc.fileData){
      return new Response(new Uint8Array(doc.fileData as Buffer),{headers:{
        "Content-Type":doc.mimeType||"application/octet-stream",
        "Content-Disposition":`attachment; filename="${(doc.fileName||doc.title).replace(/["\\]/g,"_")}"`,
        "Content-Length":String(doc.fileSize||doc.fileData.length),
      }});
    }
    if(doc.externalUrl)return Response.redirect(doc.externalUrl);
    return notFound("Document content is unavailable.");
  }
  const {fileData,...metadata}=doc;
  return ok({...metadata,hasFile:Boolean(fileData)});
}

export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const auth=await authorize("documents","edit"); if(!auth.ok)return auth.response;
  const {id}=await params;
  const existing=await db.document.findFirst({where:{id,...notDeleted()}});
  if(!existing)return notFound("Document not found.");
  let body:any; try{body=await req.json();}catch{return badRequest("Invalid JSON body.");}
  const title=body.title===undefined?existing.title:String(body.title).trim();
  const category=body.category===undefined?existing.category:String(body.category).trim();
  if(!title||!category)return badRequest("Title and category are required.");
  const externalUrl=body.externalUrl===undefined?existing.externalUrl:(body.externalUrl?String(body.externalUrl).trim():null);
  if(externalUrl&&!/^https?:\/\//i.test(externalUrl))return badRequest("External URL must start with http:// or https://.");
  const doc=await db.document.update({where:{id},data:{
    title,category,
    description:body.description===undefined?existing.description:(body.description?String(body.description).trim():null),
    externalUrl,
    entityType:body.entityType===undefined?existing.entityType:(body.entityType?String(body.entityType).trim():null),
    entityId:body.entityId===undefined?existing.entityId:(body.entityId?String(body.entityId).trim():null),
  },select:{id:true,documentNumber:true,title:true,category:true,description:true,fileName:true,mimeType:true,fileSize:true,externalUrl:true,entityType:true,entityId:true,status:true,createdAt:true}});
  await auditFromCtx(auth.ctx,{action:"update",module:"documents",recordId:id,recordType:"Document",description:`Updated document ${doc.documentNumber}`});
  return ok(doc);
}

export async function DELETE(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const auth=await authorize("documents","delete"); if(!auth.ok)return auth.response;
  const {id}=await params; const existing=await db.document.findFirst({where:{id,...notDeleted()}});
  if(!existing)return notFound("Document not found.");
  await db.document.update({where:{id},data:{deletedAt:new Date(),status:"archived"}});
  await auditFromCtx(auth.ctx,{action:"delete",module:"documents",recordId:id,recordType:"Document",description:`Archived document ${existing.documentNumber}`});
  return ok({id,archived:true});
}
