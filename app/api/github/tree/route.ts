import { NextRequest, NextResponse } from 'next/server';
import { vaultConfigured, vaultRepositoryTree, vaultSource } from '@/lib/vault-repository';
import { requireP0Session } from '@/lib/p0-server';
export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!vaultConfigured()) return NextResponse.json({ configured:false, source:'none', items:[] });
  try {
    const source = vaultSource() || 'local';
    return NextResponse.json({ configured:true, source, items:await vaultRepositoryTree() });
  }
  catch (e) { return NextResponse.json({ configured:true, error:String(e), items:[] }, {status:502}); }
}
