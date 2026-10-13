'use client';
import {createContext,useContext} from 'react';
import type {AppContextValue} from './types';
export const AppContext=createContext<AppContextValue|null>(null);
export function useApp(){const value=useContext(AppContext);if(!value)throw new Error('Workspace context required');return value;}
