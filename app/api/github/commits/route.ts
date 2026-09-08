import { NextResponse } from 'next/server';
import { getCommits, githubConfigured } from '@/lib/github';
export async function GET() {
  if (!githubConfigured()) return NextResponse.json({ configured:false, items:[] });
  try { return NextResponse.json({ configured:true, items:await getCommits() }); }
  catch (e) { return NextResponse.json({ configured:true, error:String(e), items:[] }, {status:502}); }
}
