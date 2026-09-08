import { NextResponse } from 'next/server';
import { getDashboardBundle } from '@/lib/results';

export async function GET() {
  return NextResponse.json(await getDashboardBundle());
}
