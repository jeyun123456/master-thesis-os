import { NextRequest, NextResponse } from 'next/server';
import { getCommits, githubConfigured } from '@/lib/github';
import { requireP0Session } from '@/lib/p0-server';
export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!githubConfigured()) return NextResponse.json({ configured:false, items:[] });
  try { return NextResponse.json({ configured:true, items:await getCommits() }); }
  catch (e) { return NextResponse.json({ configured:true, error:String(e), items:[] }, {status:502}); }
}
