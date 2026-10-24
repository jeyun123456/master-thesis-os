import { NextRequest, NextResponse } from 'next/server';
import { getFile, githubConfigured } from '@/lib/github';
import { requireP0Session } from '@/lib/p0-server';
export async function GET(req: NextRequest) {
  const authError = await requireP0Session(req);
  if (authError) return authError;
  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({error:'path required'},{status:400});
  if (!githubConfigured()) return NextResponse.json({configured:false});
  try { return NextResponse.json({configured:true, item:await getFile(path)}); }
  catch (e) {
    const message = e instanceof Error ? e.message : 'GitHub request failed';
    const status = message === 'Invalid repository-relative path' ? 400 : 502;
    return NextResponse.json({configured:true,error:message},{status});
  }
}
