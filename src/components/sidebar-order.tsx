'use client';
import {useEffect,useId,useState,type CSSProperties,type KeyboardEvent} from 'react';
import {DndContext,closestCenter,PointerSensor,useSensor,useSensors,type DragEndEvent} from '@dnd-kit/core';
import {SortableContext,useSortable,rectSortingStrategy,arrayMove} from '@dnd-kit/sortable';
import {GripVertical,ArrowUp,ArrowDown} from 'lucide-react';
import {useApp} from './context';
import './sidebar-order.css';

type Props={order:string[];hidden?:string[];onChange:(order:string[])=>void;onVisibilityChange?:(hidden:string[])=>void};

export default function SidebarOrder({order,hidden=[],onChange,onVisibilityChange}:Props){
 const {t}=useApp();
 const id=useId();
 const [keyboard,setKeyboard]=useState<{item:string;order:string[]}|null>(null);
 const [announcement,setAnnouncement]=useState('');
 const visibleOrder=keyboard?.order??order;
 // Keyboard reordering follows logical indices; geometry-based sensors mis-scroll
 // when Down wraps from the bottom of the left column to the top of the right.
 useEffect(()=>{if(keyboard)document.getElementById(`${id}-${keyboard.item}`)?.scrollIntoView({block:'nearest',inline:'nearest'});},[id,keyboard]);
 const keyboardMove=(event:KeyboardEvent<HTMLButtonElement>,item:string)=>{
  if(event.code==='Tab'&&keyboard){setKeyboard(null);setAnnouncement(t('sidebarDragCancelled'));return;}
  if(!['Space','Enter','ArrowDown','ArrowUp','Escape'].includes(event.code))return;
  if(!keyboard){
   if(event.code==='Space'||event.code==='Enter'){event.preventDefault();setKeyboard({item,order:[...order]});setAnnouncement(`${t('sidebarPickedUp')}: ${t(item)}.`);}
   return;
  }
  event.preventDefault();
  if(event.code==='Escape'){setKeyboard(null);setAnnouncement(`${t('sidebarDragCancelled')}: ${t(keyboard.item)}.`);return;}
  if(event.code==='Space'||event.code==='Enter'){onChange(keyboard.order);setKeyboard(null);setAnnouncement(`${t('sidebarDropped')}: ${t(keyboard.item)}. ${t('sidebarPosition')} ${keyboard.order.indexOf(keyboard.item)+1} / ${order.length}.`);return;}
  const from=keyboard.order.indexOf(keyboard.item),to=from+(event.code==='ArrowDown'?1:-1);
  if(to>=0&&to<keyboard.order.length){setKeyboard({...keyboard,order:arrayMove(keyboard.order,from,to)});setAnnouncement(`${t(keyboard.item)}. ${t('sidebarPosition')} ${to+1} / ${order.length}.`);}
 };
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
 const move=(from:number,to:number)=>{if(from>=0&&to>=0&&from<order.length&&to<order.length&&from!==to)onChange(arrayMove(order,from,to));};
 const end=({active,over}:DragEndEvent)=>{if(over)move(order.indexOf(String(active.id)),order.indexOf(String(over.id)));};
 const position=(key:unknown)=>`${t('sidebarPosition')} ${order.indexOf(String(key))+1} / ${order.length}`;
 return <section className="sidebar-order-section" aria-labelledby={`${id}-title`}>
  <h3 id={`${id}-title`}>{t('sidebar')}</h3>
  <p id={`${id}-keyboard`} className="sidebar-sort-announcement">{t('sidebarKeyboardHint')}</p>
  <div className="sidebar-sort-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
  <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={end} accessibility={{
   screenReaderInstructions:{draggable:t('sidebarKeyboardHint')},
   announcements:{
    onDragStart:({active})=>`${t('sidebarPickedUp')}: ${t(String(active.id))}. ${position(active.id)}.`,
    onDragOver:({active,over})=>over?`${t(String(active.id))}. ${position(over.id)}.`:undefined,
    onDragEnd:({active,over})=>`${t(over?'sidebarDropped':'sidebarDragCancelled')}: ${t(String(active.id))}. ${position(over?.id??active.id)}.`,
    onDragCancel:({active})=>`${t('sidebarDragCancelled')}: ${t(String(active.id))}.`,
   },
  }}>
   <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
    <ol className="sidebar-order" style={{'--sidebar-order-rows':Math.ceil(order.length/2)} as CSSProperties}>
     {visibleOrder.map((key,index)=><SortableNavigationItem key={key} item={key} handleId={`${id}-${key}`} instructions={`${id}-keyboard`} index={index} count={order.length} visible={!hidden.includes(key)} onVisibilityChange={onVisibilityChange?visible=>onVisibilityChange(visible?hidden.filter(item=>item!==key):[...new Set([...hidden,key])]):undefined} keyboardActive={keyboard?.item===key} keyboardSorting={keyboard!==null} onKeyDown={event=>keyboardMove(event,key)} move={to=>move(index,to)}/>)}
    </ol>
   </SortableContext>
  </DndContext>
 </section>;
}

function SortableNavigationItem({item,handleId,instructions,index,count,visible,onVisibilityChange,keyboardActive,keyboardSorting,onKeyDown,move}:{item:string;handleId:string;instructions:string;index:number;count:number;visible:boolean;onVisibilityChange?:(visible:boolean)=>void;keyboardActive:boolean;keyboardSorting:boolean;onKeyDown:(event:KeyboardEvent<HTMLButtonElement>)=>void;move:(to:number)=>void}){
 const {t}=useApp();
 const {setNodeRef,setActivatorNodeRef,attributes,listeners,transform,transition,isDragging,isSorting}=useSortable({id:item});
 const label=t(item);
 const style:CSSProperties={transform:transform?`translate3d(${transform.x}px,${transform.y}px,0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`:undefined,transition};
 return <li ref={setNodeRef} style={style} className={`sidebar-order-item${isDragging||keyboardActive?' is-dragging':''}`} data-id={item}>
  <button id={handleId} type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} onPointerDown={event=>{if(!keyboardSorting)listeners?.onPointerDown?.(event);}} onKeyDown={onKeyDown} aria-pressed={isDragging||keyboardActive} aria-describedby={instructions} className="icon-button sidebar-drag-handle" aria-label={`${t('sidebarDrag')}: ${label}`} title={t('sidebarKeyboardHint')}><GripVertical size={17}/></button>
  <span className="sidebar-order-number" aria-hidden="true">{index+1}</span>
  <span className="sidebar-order-label">{label}</span>
  {onVisibilityChange&&<label className="sidebar-visibility"><input type="checkbox" checked={visible} onChange={event=>onVisibilityChange(event.target.checked)} disabled={isSorting||keyboardSorting} aria-label={`${t('sidebarShow')}: ${label}`}/><span>{t('show')}</span></label>}
  <button type="button" className="icon-button" aria-label={`${t('moveUp')}: ${label}`} disabled={index===0||isSorting||keyboardSorting} onClick={()=>move(index-1)}><ArrowUp size={16}/></button>
  <button type="button" className="icon-button" aria-label={`${t('moveDown')}: ${label}`} disabled={index===count-1||isSorting||keyboardSorting} onClick={()=>move(index+1)}><ArrowDown size={16}/></button>
 </li>;
}
