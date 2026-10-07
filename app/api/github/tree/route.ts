import { NextResponse } from 'next/server';
import { vaultConfigured, vaultRepositoryTree, vaultSource } from '@/lib/vault-repository';
export async function GET() {
  if (!vaultConfigured()) return NextResponse.json({ configured:false, source:'none', items:[] });
  try {
    const source = vaultSource() || 'local';
    return NextResponse.json({ configured:true, source, items:await vaultRepositoryTree() });
  }
  catch (e) { return NextResponse.json({ configured:true, error:String(e), items:[] }, {status:502}); }
}
