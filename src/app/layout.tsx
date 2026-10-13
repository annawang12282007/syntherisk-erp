import type {Metadata} from 'next';
import {Suspense} from 'react';
import WorkspaceApp from '@/components/workspace-app';
import {headers} from 'next/headers';
import {context} from '@/lib/http';
import {readPreferences} from '@/lib/preferences';
import {defaultTheme,darkTheme} from '@/components/theme';
import './globals.css';
export const metadata:Metadata={title:'Syntherisk ERP',description:'Open-source ERP and Taiwan workforce operations',icons:{icon:'/brand/favicon.svg',apple:'/brand/apple-touch-icon.png'}};
export default async function RootLayout({children}:{children:React.ReactNode}){let prefs:Record<string,unknown>={};try{prefs=await readPreferences(await context(new Request(process.env.APP_URL||'http://localhost:3000',{headers:await headers()})));}catch{}const theme={...defaultTheme,...(prefs.theme as object||{})};const tokens=theme.mode==='dark'?darkTheme:theme.mode==='custom'?theme:defaultTheme;const style:Record<string,string>={'--font-size':`${theme.fontSize}px`,'--radius':`${theme.radius}px`};if(theme.mode!=='system')for(const key of ['primary','background','surface','text','border']as const)style[`--${key}`]=tokens[key];return <html lang={prefs.locale==='en'?'en':prefs.locale==='zh-CN'?'zh-Hans':'zh-Hant'} data-theme={theme.mode} data-density={theme.density} style={style as React.CSSProperties} suppressHydrationWarning><head><link rel="stylesheet" href="/fonts/typography.css"/></head><body><Suspense><WorkspaceApp/></Suspense>{children}</body></html>;}
