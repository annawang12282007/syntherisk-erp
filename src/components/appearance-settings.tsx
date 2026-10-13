'use client';
import {useEffect,useState} from 'react';
import {Check,Download,Upload} from 'lucide-react';
import {useApp} from './context';
import {post,errorMessage,downloadFile} from './api';
import {Badge,Button,Modal} from './primitives';
import {contrast,defaultTheme,beginThemePreview,endThemePreview} from './theme';
import type {Preferences,Theme} from './types';
import './appearance-settings.css';

const modes=['light','dark','system','custom'] as const;
const colors=['primary','background','surface','text','border'] as const;
const descriptions={light:'themeLightDescription',dark:'themeDarkDescription',system:'themeSystemDescription',custom:'themeCustomDescription'} as const;

export default function AppearanceSettings(){
 const {t,prefs,savePrefs,notify,me}=useApp();
 const [theme,setTheme]=useState<Theme>({...defaultTheme,...prefs.theme});
 const [busy,setBusy]=useState(false);
 const [preset,setPreset]=useState(false);
 const [name,setName]=useState('');
 useEffect(()=>{beginThemePreview(theme);return()=>endThemePreview({...defaultTheme,...prefs.theme});},[theme,prefs.theme]);
 const save=async()=>{setBusy(true);try{await savePrefs({...prefs,theme});notify(t('preferencesSaved'));}catch(e){notify(errorMessage(e,t),'error');}finally{setBusy(false);}};
 const lowContrast=theme.mode==='custom'&&contrast(theme.text,theme.surface)<4.5;
 return <div className="settings-card appearance-settings">
  <header><h2>{t('appearance')}</h2><Badge value="previewLive"/></header>
  <p className="appearance-save-hint">{t('themeSaveHint')}</p>
  <div className="theme-mode-grid" role="group" aria-label={t('theme')}>
   {modes.map(mode=><button key={mode} aria-label={t(mode)} aria-pressed={theme.mode===mode} aria-describedby={`theme-description-${mode}`} className={`theme-choice ${theme.mode===mode?'selected':''}`} onClick={()=>setTheme(current=>({...current,mode}))}>
    <span className={`theme-mini ${mode}`} aria-hidden="true" style={mode==='custom'?{background:theme.background,borderColor:theme.border}:undefined}><i style={mode==='custom'?{background:theme.primary}:undefined}/><i style={mode==='custom'?{background:theme.surface}:undefined}/><i style={mode==='custom'?{background:theme.surface}:undefined}/></span>
    <span>{t(mode)}{theme.mode===mode&&<Check size={15}/>}</span>
    <small id={`theme-description-${mode}`}>{t(descriptions[mode])}</small>
   </button>)}
  </div>
  {theme.mode==='custom'?<fieldset className="appearance-section custom-palette">
   <legend>{t('themeCustomPalette')}</legend><p>{t('themePalettePreserved')}</p>
   <div className="form-grid">{colors.map(key=><div className="field" key={key}><label htmlFor={`theme-color-${key}`}>{t(key)}</label><div className="color-field"><input id={`theme-color-${key}`} type="color" aria-label={t(key)} value={theme[key]} onChange={e=>setTheme({...theme,[key]:e.target.value})}/><input aria-label={`${t(key)} HEX`} value={theme[key]} pattern="#[0-9A-Fa-f]{6}" maxLength={7} onChange={e=>{if(/^#[0-9a-f]{6}$/i.test(e.target.value))setTheme({...theme,[key]:e.target.value});}}/></div></div>)}</div>
   {lowContrast&&<div className="warning-banner"><span>{t('contrastWarning')} ({contrast(theme.text,theme.surface).toFixed(2)}:1)</span><Button onClick={()=>setTheme({...theme,text:contrast('#173341',theme.surface)>=4.5?'#173341':'#FFFFFF'})}>{t('fixContrast')}</Button></div>}
  </fieldset>:<div className="appearance-mode-summary"><strong>{t(theme.mode)}</strong><p>{t(descriptions[theme.mode])}</p><span>{t('themeBuiltInPaletteHint')}</span></div>}
  <fieldset className="appearance-section appearance-common">
   <legend>{t('themeSharedControls')}</legend><p>{t('themeSharedControlsHint')}</p>
   <div className="form-grid">
    <div className="field"><label htmlFor="theme-font-size">{t('fontSize')} · {theme.fontSize}px</label><input id="theme-font-size" aria-label={t('fontSize')} type="range" min={12} max={22} value={theme.fontSize} onChange={e=>setTheme({...theme,fontSize:Number(e.target.value)})}/></div>
    <div className="field"><label htmlFor="theme-ui-font-size">{t('uiFontSize')} · {theme.uiFontSize??14}px</label><input id="theme-ui-font-size" aria-label={t('uiFontSize')} type="range" min={12} max={22} value={theme.uiFontSize??14} onChange={e=>setTheme({...theme,uiFontSize:Number(e.target.value)})}/><small>{t('uiFontSizeHint')}</small></div><div className="field"><label htmlFor="theme-radius">{t('radius')} · {theme.radius}px</label><input id="theme-radius" aria-label={t('radius')} type="range" min={0} max={20} value={theme.radius} onChange={e=>setTheme({...theme,radius:Number(e.target.value)})}/></div>
    <div className="field"><label htmlFor="theme-density">{t('density')}</label><select id="theme-density" aria-label={t('density')} value={theme.density} onChange={e=>setTheme({...theme,density:e.target.value as Theme['density']})}>{['comfortable','standard','compact'].map(value=><option key={value} value={value}>{t(value)}</option>)}</select></div>
   </div>
  </fieldset>
  <section className="theme-preview appearance-preview" aria-label={t('themePreviewTitle')}>
   <span className="eyebrow">{t('themePreviewTitle')}</span>
   <div><h3>{t('themePreviewHeading')}</h3><span className="appearance-sample-label">{t('themePreviewLabel')}</span></div>
   <p>{t('themePreviewHint')}</p>
   <div className="appearance-example-line"><span>{t('themePreviewText')}</span><span className="btn primary appearance-example-button">{t('themeSample')}</span></div>
  </section>
  {prefs.themePresets?.length?<div className="preset-list"><h3>{t('presets')}</h3>{prefs.themePresets.map(item=><button key={item.name} onClick={()=>setTheme({...defaultTheme,...item.theme})}><span style={{background:item.theme.primary}}/>{item.name}</button>)}</div>:null}
  <footer className="settings-footer">
   <Button onClick={()=>setTheme({...defaultTheme})}>{t('reset')}</Button>
   <Button onClick={()=>{setName('');setPreset(true);}}>{t('savePreset')}</Button>
   <Button icon={Download} onClick={()=>downloadFile('syntherisk-preferences.json',JSON.stringify({...prefs,theme},null,2))}>{t('exportSettings')}</Button>
   <label className="btn"><Upload size={16}/>{t('importSettings')}<input type="file" hidden accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text()) as Preferences;await savePrefs(parsed);if(parsed.theme)setTheme({...defaultTheme,...parsed.theme});notify(t('preferencesSaved'));}catch(error){notify(errorMessage(error,t),'error');}}}/></label>
   {me.roles.includes('admin')&&<Button onClick={async()=>{try{await post('/api/preferences',{action:'publish-default',preferences:{...prefs,theme}});notify(t('success'));}catch(e){notify(errorMessage(e,t),'error');}}}>{t('publishDefault')}</Button>}
   <Button variant="primary" disabled={busy} icon={Check} onClick={()=>void save()}>{busy?t('saving'):t('save')}</Button>
  </footer>
  {preset&&<Modal title={t('savePreset')} onClose={()=>setPreset(false)} footer={<Button variant="primary" disabled={!name.trim()} onClick={async()=>{try{await savePrefs({...prefs,theme,themePresets:[...(prefs.themePresets||[]).filter(item=>item.name!==name),{name,theme}]});setPreset(false);notify(t('preferencesSaved'));}catch(error){notify(errorMessage(error,t),'error');}}}>{t('save')}</Button>}><div className="field"><label>{t('name')}</label><input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></div></Modal>}
 </div>;
}
