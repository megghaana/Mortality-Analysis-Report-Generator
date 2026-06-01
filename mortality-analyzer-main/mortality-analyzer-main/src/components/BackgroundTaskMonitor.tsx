import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, CheckCircle2, AlertCircle, Clock, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ProcessingTask {
  id: string;
  name: string;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  startTime: number;
  estimatedCompletionTime?: number; // timestamp
}

interface BackgroundTaskMonitorProps {
  tasks: ProcessingTask[];
  onRemoveTask: (id: string) => void;
}

export const BackgroundTaskMonitor: React.FC<BackgroundTaskMonitorProps> = ({ tasks, onRemoveTask }) => {
  if (tasks.length === 0) return null;

  const activeCount = tasks.filter(t => t.status === 'processing' || t.status === 'pending').length;

  return (
    <div className="fixed bottom-24 left-8 z-[90] w-80 space-y-3 pointer-events-none">
      <AnimatePresence>
        {tasks.map((task) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95 }}
            className="pointer-events-auto"
          >
            <div className={cn(
              "glass rounded-2xl border p-4 shadow-2xl relative overflow-hidden group",
              task.status === 'error' ? "border-red-500/20 bg-red-500/[0.02]" : "border-white/5 bg-zinc-950/60"
            )}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border",
                    task.status === 'processing' ? "bg-blue-500/10 border-blue-500/20 text-blue-400" :
                    task.status === 'completed' ? "bg-green-500/10 border-green-500/20 text-green-500" :
                    task.status === 'error' ? "bg-red-500/10 border-red-500/20 text-red-500" :
                    "bg-zinc-800 border-zinc-700 text-zinc-500"
                  )}>
                    {task.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {task.status === 'completed' && <CheckCircle2 className="h-4 w-4" />}
                    {task.status === 'error' && <AlertCircle className="h-4 w-4" />}
                    {task.status === 'pending' && <Clock className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate pr-4">{task.name}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
                      {task.status === 'processing' ? `Processing... ${task.progress}%` :
                       task.status === 'completed' ? 'Extraction Succeeded' :
                       task.status === 'error' ? 'Extraction Failed' : 'In Queue'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => onRemoveTask(task.id)}
                  className="p-1 rounded-md hover:bg-white/5 text-zinc-600 hover:text-white transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {task.status === 'processing' && (
                <div className="mt-4 space-y-2">
                  <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${task.progress}%` }}
                      className="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                    />
                  </div>
                  {task.estimatedCompletionTime && (
                    <div className="flex items-center justify-between text-[9px] text-zinc-600 font-mono font-bold">
                      <span className="uppercase">EST. COMPLETION</span>
                      <span>{new Date(task.estimatedCompletionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              )}

              {task.status === 'error' && task.error && (
                <p className="mt-2 text-[10px] text-red-400 font-medium bg-red-500/5 p-2 rounded-lg border border-red-500/10">
                  {task.error}
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
