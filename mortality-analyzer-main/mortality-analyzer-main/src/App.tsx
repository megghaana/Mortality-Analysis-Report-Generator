import { useState, useMemo, useEffect, useRef, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  Bell, 
  Users,
  Search, 
  ChevronRight, 
  MoreHorizontal, 
  ArrowUpRight, 
  Plus,
  Play,
  Upload,
  Bot,
  Zap,
  Shield,
  Clock,
  Activity,
  Maximize2,
  FileSearch,
  UploadCloud,
  ShieldAlert,
  LayoutDashboard,
  Mic,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Brain,
  History,
  FileText,
  X,
  Loader2,
  LogOut,
  LogIn
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { cn } from './lib/utils';
import { BackgroundTaskMonitor } from './components/BackgroundTaskMonitor';
import { NAVIGATION_ITEMS, SYSTEM_STATS, RECENT_ACTIVITY, PATIENT_DATA, DATA_STREAMS } from './constants';
// Authentication state and types
type User = {
  id: string;
  displayName: string | null;
  email: string | null;
  photo_url: string | null;
};
const vitalsData = [
  { time: '00:00', hr: 72, bp: 120, temp: 98.6 },
  { time: '04:00', hr: 68, bp: 118, temp: 98.4 },
  { time: '08:00', hr: 85, bp: 125, temp: 99.1 },
  { time: '12:00', hr: 82, bp: 130, temp: 99.4 },
  { time: '16:00', hr: 88, bp: 132, temp: 99.2 },
  { time: '20:00', hr: 78, bp: 128, temp: 98.9 },
];
const labData = [
  { name: 'WBC', value: 8.5, normal: [4.5, 11] },
  { name: 'HGB', value: 14.2, normal: [13.5, 17.5] },
  { name: 'PLT', value: 245, normal: [150, 450] },
  { name: 'SOD', value: 138, normal: [135, 145] },
];
const isAIQuotaError = (err: any) => {
  const status = err?.status;
  const message = String(err?.message || err || '').toLowerCase();
  return (
    status === 429 ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit')
  );
};
const getAIErrorMessage = (err: any) => {
  const status = err?.status;
  const message = String(err?.message || err || 'An unknown AI error occurred.');
  if (isAIQuotaError(err)) {
    return 'AI Quota exceeded. Please wait a moment or try again later.';
  }
  if (status === 401 || status === 403) {
    return `AI access denied: ${message}`;
  }
  return message;
};
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // New state for Patients and AI
  const [patients, setPatients] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState('All Patients');
  const [sortKey, setSortKey] = useState('name');
  const [searchQuery, setSearchQuery] = useState('');
  const [showEnrollmentModal, setShowEnrollmentModal] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  // Transcript editing/download state
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  // OCR State
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [summaryOutput, setSummaryOutput] = useState<string | null>(null);
  const [isSummaryPanelOpen, setIsSummaryPanelOpen] = useState(false);
  const [ocrResults, setOcrResults] = useState<
    Array<{ fileName: string; pages: Array<{ page: number; lines: Array<{ lineRef: string; text: string }>; words: any[] }>; text: string }>
  >([]);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  
  // AI Assistant State
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
    { role: 'assistant', content: "Hello, I'm your AI Clinical Assistant. How can I help you today with patient analytics or case reviews?" }
  ]);
  const [currentInput, setCurrentInput] = useState('');
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [isAIQuotaPaused, setIsAIQuotaPaused] = useState(false);
  const [quotaCooldownUntil, setQuotaCooldownUntil] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  useEffect(() => {
    const savedUser = localStorage.getItem('matrix_user');
    const savedToken = localStorage.getItem('matrix_token');
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setToken(savedToken);
    }
    setAuthLoading(false);
  }, []);
  const withRetry = async <T,>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 2000
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err: any) {
      if (isAIQuotaError(err)) {
        // Quota errors should pause further AI work instead of hammering the API.
        throw err;
      }
      if (retries > 0) {
        console.log(`AI request failed. Retrying in ${delay / 1000}s... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(fn, retries - 1, delay * 2);
      }
      throw err;
    }
  };
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
    try {
      const res = await fetch(url, {
        ...options,
        headers,
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        throw new Error("Session expired. Please login again.");
      }
      return res;
    } catch (err) {
      console.error(`Fetch error for ${url}:`, err);
      throw err;
    }
  };
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);
  const isQuotaCoolingDown = Date.now() < quotaCooldownUntil;
  // Extract patient names from OCR text for quick reference
  const extractPatientNames = (text: string): string[] => {
    if (!text) return [];
    
    // Common patterns for patient names in medical records
    const namePatterns = [
      /(?:patient|name|pt)[\s:]+([A-Z][a-z]+ [A-Z][a-z]+)/gi,
      /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is\s+|\s+was\s+|\s+presented\s+|\s+admitted\s+)/gi,
      /(?:mr\.?|mrs\.?|ms\.?|dr\.?)\s+([A-Z][a-z]+ [A-Z][a-z]+)/gi,
      /admit\s+([A-Z][a-z]+ [A-Z][a-z]+)/gi
    ];
    
    const names = new Set<string>();
    namePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        if (name.length > 3 && name.length < 50) { // Reasonable name length
          names.add(name);
        }
      }
    });
    
    return Array.from(names).slice(0, 3); // Limit to top 3 matches
  };
  const getPatientNames = () => {
    const names = extractPatientNames(ocrText || '');
    if (names.length > 0) {
      return `Patient names detected from recent OCR: ${names.join(', ')}`;
    }
    if (selectedPatient?.name) {
      return `Current selected patient: ${selectedPatient.name}`;
    }
    return "No patient names detected. Please upload clinical documents first.";
  };
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentInput.trim() || isAssistantTyping) return;
    if (isAIQuotaPaused || isQuotaCoolingDown) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'AI quota is currently paused. Please wait a moment or try again later.' }]);
      return;
    }
    const userMessage = currentInput.trim();
    setCurrentInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsAssistantTyping(true);
    const normalizeSentence = (text: string): string => {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!t) return '';
      if (/[.!?]$/.test(t)) return t;
      return `${t}.`;
    };
    const transcriptPages: any[] =
      selectedCase?.transcript && Array.isArray(selectedCase.transcript) ? selectedCase.transcript : [];
    const transcriptContextFromCase = transcriptPages.length
      ? (() => {
          // Limit case transcript to prevent token limit issues
          const maxPages = 5; // Limit to first 5 pages
          const limitedPages = transcriptPages.slice(0, maxPages);
          const context = limitedPages
            .slice()
            .sort((a: any, b: any) => {
              const ap = typeof a?.page === 'number' ? a.page : Number(a?.page ?? 0);
              const bp = typeof b?.page === 'number' ? b.page : Number(b?.page ?? 0);
              if (ap !== bp) return ap - bp;
              return String(a?.fileName ?? '').localeCompare(String(b?.fileName ?? ''));
            })
            .map((page: any) => {
              const header = `File: ${page.fileName ?? 'Unknown'} | Page ${page.page ?? ''}`;
              const lines = (page.lines ?? [])
                .map((line: any) => {
                  const lineText = normalizeSentence(line.text);
                  const lineRef = line.lineRef != null ? String(line.lineRef) : '';
                  return lineText ? (lineRef ? `${lineRef}: ${lineText}` : lineText) : '';
                })
                .filter(Boolean)
                .join(' ');
              return `${header}\n${lines}`;
            })
            .join('\n\n');
          
          const totalLength = context.length;
          const maxLength = 4000; // Conservative limit
          return totalLength > maxLength 
            ? context.substring(0, maxLength) + '...[truncated for token limit]'
            : context;
        })()
      : '';
    const transcriptContextFromLatestOCR =
      transcriptContextFromCase
        ? ''
        : ocrText
          ? (() => {
              // Limit OCR transcript to prevent token limit issues
              const maxLength = 3000; // Conservative limit for token safety
              const truncated = ocrText.length > maxLength 
                ? ocrText.substring(0, maxLength) + '...[truncated for token limit]'
                : ocrText;
              return `OCR Upload Transcript:\n${truncated}`;
            })()
          : '';
    const transcriptContext = transcriptContextFromCase || transcriptContextFromLatestOCR;
    const extractedPatientNames = extractPatientNames(ocrText || '');
    const patientContext = selectedPatient ? `
Current Patient Context:
Name: ${selectedPatient.name}
Age/Gender: ${selectedPatient.age || 'N/A'} / ${selectedPatient.gender || 'N/A'}
Condition: ${selectedPatient.condition || 'N/A'}
Risk Score: ${selectedCase?.risk_score || 'N/A'}
Mortality Index: ${selectedCase?.mortality_index || 'N/A'}
Clinical Alerts: ${selectedCase?.alerts?.map((a: any) => a.title).join(', ') || 'None'}
Timeline Events: ${selectedCase?.timeline?.map((t: any) => `${t.time}: ${t.title}`).join(' | ') || 'None'}
Document Summary: ${selectedCase?.summary || 'None'}
${transcriptContext ? `\nDocument Transcript:\n${transcriptContext}` : ''}
` : extractedPatientNames.length > 0 
  ? `Detected patient names from recent OCR: ${extractedPatientNames.join(', ')}\n\n${transcriptContext ? `Recent OCR Context:\n${transcriptContext}` : 'No patient currently selected.'}`
  : 'No patient currently selected.';
    try {
      // Handle simple queries without calling Groq to avoid token limits
      const lowerMessage = userMessage.toLowerCase().trim();
      if (lowerMessage.includes('patient name') || lowerMessage.includes('what is the patient') || lowerMessage.includes('who is the patient')) {
        const patientInfo = getPatientNames();
        setChatMessages(prev => [...prev, { role: 'assistant', content: patientInfo }]);
        setIsAssistantTyping(false);
        return;
      }
      const groqMessages = [
        {
          role: 'system',
          content: `You are a highly skilled AI Clinical Assistant part of the 'Mortality Analysis System'. You help doctors analyze clinical data, risk scores, and patient records. Be concise, professional, and base your answers on medical evidence.\n\n${patientContext}`
        },
        ...chatMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        })),
        { role: 'user', content: userMessage }
      ];
      const response = await withRetry(() => groqChatCompletion(groqMessages));
      const fullResponse = response?.choices?.[0]?.message?.content
        || response?.choices?.[0]?.text
        || 'AI assistant did not return a valid response.';
      setChatMessages(prev => [...prev, { role: 'assistant', content: fullResponse }]);
    } catch (err: any) {
      console.error("Assistant error:", err);
      const isQuotaError = isAIQuotaError(err);
      if (isQuotaError) {
        const COOLDOWN_MS = 60_000;
        setIsAIQuotaPaused(true);
        setQuotaCooldownUntil(Date.now() + COOLDOWN_MS);
      }
      const errorMessage = getAIErrorMessage(err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: errorMessage }]);
    } finally {
      setIsAssistantTyping(false);
    }
  };
  const groqApiKey = process.env.GROQ_API_KEY || '';
  const groqChatCompletion = async (messages: Array<{ role: string; content: string }>) => {
    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY is not configured.');
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages,
        temperature: 0.2,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `${res.status} ${res.statusText}`);
    }
    return data;
  };
  const groqVisionCompletion = async (messages: Array<{ role: string; content: any[] }>, jsonMode = false) => {
    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY is not configured.');
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages,
        temperature: 0.2,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `${res.status} ${res.statusText}`);
    }
    return data;
  };
  useEffect(() => {
    if (!user) {
      setPatients([]);
      return;
    }
    const fetchPatients = async () => {
      try {
        const res = await authenticatedFetch("/api/patients");
        if (!res.ok) throw new Error("Failed to fetch patients");
        const data = await res.json();
        setPatients(data);
      } catch (err) {
        console.error("Fetch patients failed:", err);
      }
    };
    fetchPatients();
    const interval = setInterval(fetchPatients, 10000); // Polling as a simpler alternative to onSnapshot
    return () => clearInterval(interval);
  }, [user]);
  useEffect(() => {
    if (!user || !selectedPatient?.id) {
      setSelectedCase(null);
      return;
    }
    const fetchCase = async () => {
      try {
        const res = await authenticatedFetch(`/api/cases/${selectedPatient.id}`);
        if (!res.ok) throw new Error("Failed to fetch case");
        const data = await res.json();
        setSelectedCase(data);
      } catch (err) {
        console.error("Fetch case failed:", err);
      }
    };
    fetchCase();
    const interval = setInterval(fetchCase, 10000);
    return () => clearInterval(interval);
  }, [user, selectedPatient]);
  const filteredPatients = useMemo(() => {
    const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    
    return patients
      .filter(p => {
        const matchesStatus = filterStatus === 'All Patients' || p.status === filterStatus;
        
        let matchesSearch = true;
        if (searchTerms.length > 0) {
          matchesSearch = searchTerms.every(term => 
            (p.name || '').toLowerCase().includes(term) || 
            (p.mrn || '').toLowerCase().includes(term) ||
            (p.status || '').toLowerCase().includes(term) ||
            (p.age || '').toLowerCase().includes(term)
          );
        }
        
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => {
        if (sortKey === 'name') return a.name.localeCompare(b.name);
        if (sortKey === 'mrn') return a.mrn.localeCompare(b.mrn);
        if (sortKey === 'date') return new Date(b.admission_date).getTime() - new Date(a.admission_date).getTime();
        return 0;
      });
  }, [patients, filterStatus, sortKey, searchQuery]);
  const handleManualEnroll = async (e: any) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.target);
    const newPatient = {
      name: formData.get('name') as string,
      age: formData.get('age') as string,
      mrn: formData.get('mrn') as string,
      status: formData.get('status') as string,
      color: formData.get('status') === 'Critical' ? 'red' : 'blue',
      owner_id: user.id,
      admission_date: new Date().toISOString()
    };
    
    try {
      const res = await authenticatedFetch("/api/patients", {
        method: "POST",
        body: JSON.stringify(newPatient)
      });
      if (!res.ok) throw new Error("Failed to create patient");
      setShowEnrollmentModal(false);
    } catch (err) {
      console.error("Create patient failed:", err);
    }
  };
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };
  const uploadFileForOCR = async (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    const res = await fetch('/api/ocr', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || errorData?.details || `OCR upload failed with status ${res.status}`);
    }
    return await res.json();
  };
  const cleanTranscriptForSummary = (transcript: string): string => {
    const raw = String(transcript ?? '').replace(/\r\n/g, '\n');
    const lines = raw
      .split('\n')
      .map((line) => {
        let cleaned = line
          .replace(/<[^>]*>/g, ' ')
          .replace(/\*\*/g, '')
          .replace(/\bP\d+-L\d+:\s*/gi, '')
          .replace(/\bP\d+-W\d+:\s*/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        cleaned = cleaned
          .replace(/^#{1,6}\s*/, '')
          .replace(/^Page\s+(\d+):?$/i, 'Page $1')
          .trim();

        const noisyHeader =
          /(top[\s._-]*part|printed|medical\s*college|college|hospital|department|registration)/i.test(cleaned);
        const clinicallyRelevant =
          /\b(patient|mrn|age|sex|admission|admitted|discharge|death|expired|diagnosis|history|examination|vital|bp|pulse|temperature|spo2|lab|wbc|hgb|platelet|creatinine|medication|drug|dose|procedure|operation|surgery|intubation|ventilator|cpr|cause|doctor|consultant|provider|ward|icu|emergency)\b/i.test(cleaned);

        if (noisyHeader && !clinicallyRelevant) return '';
        return cleaned;
      })
      .filter(Boolean);

    return lines.join('\n').trim();
  };

  const chunkTranscriptForSummary = (transcript: string, maxChars = 9000): string[] => {
    const cleaned = cleanTranscriptForSummary(transcript);
    if (!cleaned) return [];

    const sections = cleaned.split(/\n(?=(?:File:|Page\s+\d+)\b)/i);
    const chunks: string[] = [];
    let current = '';

    for (const section of sections) {
      const part = section.trim();
      if (!part) continue;

      if (part.length > maxChars) {
        if (current.trim()) {
          chunks.push(current.trim());
          current = '';
        }
        for (let i = 0; i < part.length; i += maxChars) {
          chunks.push(part.slice(i, i + maxChars).trim());
        }
        continue;
      }

      if (current && current.length + part.length + 2 > maxChars) {
        chunks.push(current.trim());
        current = part;
      } else {
        current = current ? `${current}\n\n${part}` : part;
      }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
  };

  const pickUniqueLines = (lines: string[], pattern: RegExp, limit = 8) => {
    const seen = new Set<string>();
    return lines
      .filter((line) => pattern.test(line))
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => {
        const key = line.toLowerCase();
        if (!line || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  };

  const extractiveClinicalSummary = (transcript: string) => {
    const cleaned = cleanTranscriptForSummary(transcript);
    if (!cleaned) return 'No readable transcript text was available to summarize.';

    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const patientLines = pickUniqueLines(lines, /\b(patient'?s?\s*name|name\s*:|age|yrs|m\/f|mrn|hospital|date\s*:)\b/i, 8);
    const admissionLines = pickUniqueLines(lines, /\b(admission|admitted|day\s+on\s+unit|icu|ward|emergency|course|history|complain|diagnos)/i, 10);
    const diagnosisLines = pickUniqueLines(lines, /\b(pancreatitis|sepsis|shock|pneumonia|respiratory|cardiac|renal|liver|fatty|hypoechoic|lvh|diastolic|ranson|sofa|gcs|abg|creatinine|urea|bilirubin|lactate|wbc|hgb|platelet|crp|troponin|uric|lipase|amylase|kft|lft|cbc|rft|x-ray|ct|mri|usg|echo|ecg|cxr)\b/i, 14);
    const medicationLines = pickUniqueLines(lines, /\b(insulin|norad|nor-?adrenalin|adrenalin|dopamin|dobut|meropen|mero|metro|octre|thiamine|tramadol|noropen|iv fluid|ns|rl|infusion|antibiotic|drug|dose|mg|ml\/hr)\b/i, 14);
    const procedureLines = pickUniqueLines(lines, /\b(foley|catheter|arterial line|central line|peripheral cannula|et tube|tracheostomy|ventilation|bipap|cpap|oxygen|mask|nasal|cannula|dialysis|hemodialysis|cvchd|ivehd|cpr|intubation|blood transfusion|prbc|ffp|platelets)\b/i, 14);
    const providerLines = pickUniqueLines(lines, /\b(morning|evening|night|shift|doctor|consultant|nursing|signature|rmo|resident|dr\.?)\b/i, 10);
    const dispositionLines = pickUniqueLines(lines, /\b(discharge|expired|death|died|dead|cause of death|outcome|referred|lama|absconded)\b/i, 8);

    const section = (title: string, items: string[], missing = 'Not found in readable OCR.') =>
      `**${title}**\n${items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${missing}`}`;

    return [
      section('Patient identifiers', patientLines),
      section('Admission and clinical course', admissionLines),
      section('Key diagnoses, investigations, and findings', diagnosisLines),
      section('Medications and treatments', medicationLines),
      section('Procedures, devices, and interventions', procedureLines),
      section('Providers / shift notes mentioned', providerLines),
      section('Disposition / cause of death', dispositionLines),
      section('OCR limitations', [
        'This is an extractive fallback summary generated from OCR text because the AI summarizer failed or returned an unusable response.',
        'Values from dense vitals/intake-output tables may be fragmented; verify critical numbers against the original images.',
      ], ''),
    ].join('\n\n');
  };

  const readableOcrFallback = (chunk: string) => {
    return extractiveClinicalSummary(chunk);
  };

  const summarizeTranscript = async (transcript: string) => {
    const fallbackSummary = extractiveClinicalSummary(transcript);
    const chunks = chunkTranscriptForSummary(transcript);
    if (chunks.length === 0) return 'No readable transcript text was available to summarize.';
    const chunksForAi = chunks.length > 8 ? chunks.slice(0, 8) : chunks;

    const systemPrompt =
      'You are a careful clinical summarization assistant. Use only the provided OCR transcript. Preserve exact names, dates, diagnoses, medications, procedures, vitals, lab values, providers, disposition, and cause of death when present. Do not infer missing facts. If OCR is unclear, say "unclear in OCR".';

    const summarizeChunk = async (chunk: string, index: number) => {
      const response = await withRetry(() => groqChatCompletion([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Extract the readable information from transcript chunk ${index + 1} of ${chunksForAi.length}. Prioritize clinically important facts, but if this page only contains administrative, demographic, or unclear OCR text, summarize that instead of returning an empty answer. Keep line/page context when visible. Return concise bullets under these headings: Patient identifiers, Admission and course, Diagnoses and findings, Medications and treatments, Procedures, Providers, Disposition or cause of death, Other readable text, OCR uncertainties.\n\nTranscript chunk:\n${chunk}`
        }
      ]));
      return response?.choices?.[0]?.message?.content?.trim() || readableOcrFallback(chunk);
    };

    try {
      const chunkSummaries: string[] = [];
      for (let i = 0; i < chunksForAi.length; i += 1) {
        chunkSummaries.push(await summarizeChunk(chunksForAi[i], i));
      }

      if (chunks.length > chunksForAi.length) {
        chunkSummaries.push(`Additional OCR pages were present but skipped for AI token safety. Extractive fallback across all pages:\n${fallbackSummary}`);
      }

      if (chunkSummaries.length === 1) {
        return chunkSummaries[0];
      }

      const response = await withRetry(() => groqChatCompletion([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Combine these chunk-level clinical extraction notes into one accurate final summary. Remove duplicates, keep conflicting OCR details visible instead of choosing one silently, and write "Not found in transcript" for missing critical fields.\n\nRequired format:\n- Patient identifiers\n- Admission and clinical course\n- Key diagnoses and findings\n- Medications and treatments\n- Procedures and interventions\n- Providers mentioned\n- Disposition / cause of death\n- OCR uncertainties or conflicts\n\nChunk notes:\n${chunkSummaries.map((summary, index) => `Chunk ${index + 1}:\n${summary}`).join('\n\n')}`
        }
      ]));

      return response?.choices?.[0]?.message?.content?.trim() || fallbackSummary;
    } catch (err) {
      console.warn('AI summarizer failed; using extractive fallback summary:', err);
      return fallbackSummary;
    }
  };
  const getSelectedTranscriptText = (): string => {
    if (isTranscriptEditing) return transcriptDraft;
    if (selectedCase?.transcript?.length) {
      const pages: any[] = Array.isArray(selectedCase.transcript) ? selectedCase.transcript : [];
      return pages
        .map((page: any) => {
          const header = `File: ${page.fileName ?? 'Unknown'} | Page ${page.page ?? ''}`;
          const lines = (page.lines ?? [])
            .map((line: any) => String(line?.text ?? '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' ');
          return `${header}\n${lines}`;
        })
        .join('\n\n')
        .trim();
    }
    return ocrText ?? '';
  };
  const downloadTextFile = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const downloadTranscriptAsPdf = () => {
    const text = getSelectedTranscriptText();
    if (!text || !text.trim()) return;
    const safeTitle = (selectedPatient?.mrn || selectedPatient?.name || 'transcript')
      .toString()
      .replace(/[^a-z0-9\-_ ]/gi, '')
      .trim();
    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 40px; color: #111827; }
      h1 { font-size: 18px; margin: 0 0 18px 0; }
      .meta { font-size: 12px; color: #6b7280; margin-bottom: 18px; }
      pre { white-space: pre-wrap; word-wrap: break-word; font-size: 11.5px; line-height: 1.45; }
      .footer { margin-top: 24px; font-size: 10px; color: #9ca3af; }
      @media print { .noprint { display: none; } }
    </style>
  </head>
  <body>
    <h1>Mortality Matrix - Clinical Transcript</h1>
    <div class="meta">
      <div><strong>Patient:</strong> ${selectedPatient?.name ?? 'N/A'}</div>
      <div><strong>MRN:</strong> ${selectedPatient?.mrn ?? 'N/A'}</div>
      <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
    </div>
    <pre>${text.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'<','>':'>'} as any)[c] as any)}</pre>
    <div class="footer">Generated by Mortality Matrix (browser print-to-PDF).</div>
    <script>
      setTimeout(() => { window.focus(); window.print(); }, 50);
    </script>
  </body>
</html>
`;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Please allow popups to download PDF.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };
  const persistTranscriptEdits = async () => {
    const draft = transcriptDraft;
    if (!draft.trim()) return;
    if (selectedCase?.id && selectedCase?.patient_id) {
      const res = await authenticatedFetch(`/api/cases/${selectedCase.patient_id}/transcript`, {
        method: 'PATCH',
        body: JSON.stringify({ transcriptText: draft }),
      });
      if (!res.ok) throw new Error(`Failed to persist transcript edits (${res.status})`);
      const data = await res.json().catch(() => null);
      setSelectedCase((prev: any) => ({
        ...(prev || {}),
        ...(data || {}),
      }));
    }
    setOcrText(draft);
    setIsTranscriptEditing(false);
  };
  const handleQuickOCR = async (files: FileList | File[]) => {
    // When doing OCR, reset transcript editor state to show fresh transcript.
    setIsTranscriptEditing(false);
    setTranscriptDraft('');
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setIsOCRProcessing(true);
    setOcrText(null);
    try {
      const results = await uploadFileForOCR(fileArray);
      // Store page-wise OCR results so we can render page-wise transcript & summaries.
      const normalizedResults = results
        .filter((r: any) => !r?.error)
        .map((r: any) => ({
          fileName: String(r.fileName ?? ''),
          pages: Array.isArray(r.pages) ? r.pages : [],
          text: String(r.text ?? ''),
        }));
      setOcrResults(normalizedResults);
      // Process results for display with clinical highlighting and page-wise format
      const processedResults = results.map((result: any) => {
        if (result.error) {
          return {
            fileName: result.fileName,
            error: result.error,
            pages: [],
            summary: null,
            highlightedText: null
          };
        }
        // Process pages for display
        const pages = result.pages || [];
        const fullText = result.text || '';
        // Highlight clinical terms
        const clinicalTerms = [
          'diagnosis', 'treatment', 'medication', 'surgery', 'procedure', 'symptoms', 'vitals',
          'blood pressure', 'heart rate', 'temperature', 'respiratory rate', 'oxygen saturation',
          'lab results', 'x-ray', 'ct scan', 'mri', 'ultrasound', 'biopsy', 'chemotherapy',
          'radiation', 'physical therapy', 'occupational therapy', 'discharge', 'admission',
          'emergency', 'critical', 'stable', 'monitoring', 'ventilator', 'intubation',
          'defibrillation', 'cardiac arrest', 'stroke', 'heart attack', 'pneumonia', 'sepsis',
          'infection', 'fever', 'pain', 'nausea', 'vomiting', 'diarrhea', 'constipation',
          'hypertension', 'diabetes', 'asthma', 'copd', 'cancer', 'tumor', 'metastasis'
        ];
        const highlightedText = fullText.replace(
          new RegExp(`\\b(${clinicalTerms.join('|')})\\b`, 'gi'),
          '<mark class="bg-yellow-200 text-black px-1 rounded">$1</mark>'
        );
        return {
          fileName: result.fileName,
          pages,
          fullText,
          highlightedText,
          summary: null // Will be generated below
        };
      });
      const allText = processedResults
        .filter((r: any) => !r.error)
        .map((r: any) => r.fullText)
        .join('\n\n');
      // Format output with page-wise display
      const outputParts = [];
      processedResults.forEach((result: any) => {
        if (result.error) {
          outputParts.push(`## ${result.fileName}\n**Error:** ${result.error}\n`);
        } else {
          outputParts.push(`## ${result.fileName}\n`);
          if (result.pages && result.pages.length > 0) {
            result.pages.forEach((page: any) => {
              outputParts.push(`### Page ${page.page}`);
              if (page.lines && page.lines.length > 0) {
                page.lines.forEach((line: any) => {
                  outputParts.push(`${line.lineRef}: ${line.text}`);
                });
              }
              outputParts.push('');
            });
          } else {
            outputParts.push(result.highlightedText || result.fullText);
            outputParts.push('');
          }
        }
      });
      const summaryPlaceholder = `## Clinical Summary\nGenerating summary in background...\n`;
      if (allText.trim()) {
        outputParts.push(summaryPlaceholder);
      }
      setOcrText(outputParts.join('\n'));

      if (allText.trim()) {
        void (async () => {
          try {
            const combinedSummary = await summarizeTranscript(allText);
            setOcrText((prev) => {
              const summaryBlock = `## Clinical Summary\n${combinedSummary}\n`;
              if (!prev) return summaryBlock;
              return prev.includes(summaryPlaceholder)
                ? prev.replace(summaryPlaceholder, summaryBlock)
                : `${prev}\n\n${summaryBlock}`;
            });
          } catch (summaryErr) {
            console.warn("Summary generation failed:", summaryErr);
            setOcrText((prev) => {
              const failedBlock = `## Clinical Summary\nSummary generation failed. You can still use Summarize Folder after reviewing the OCR transcript.\n`;
              if (!prev) return failedBlock;
              return prev.includes(summaryPlaceholder)
                ? prev.replace(summaryPlaceholder, failedBlock)
                : `${prev}\n\n${failedBlock}`;
            });
          }
        })();
      }

      // Auto-register patient from OCR transcript (best-effort).
      // This ensures: if transcript contains patient name/MRN, it becomes visible in Patient registry.
      try {
        if (allText && allText.trim()) {
          const transcriptForPatientRegistration =
            allText.length > 50_000 ? allText.slice(0, 50_000) : allText;
          const res = await authenticatedFetch("/api/patients/from-transcript", {
            method: "POST",
            body: JSON.stringify({ transcript: transcriptForPatientRegistration }),
          });
          if (res.ok) {
            const patient = await res.json();
            setSelectedPatient(patient);
          }
        }
      } catch (err) {
        console.warn("Auto-register patient from transcript failed:", err);
      }
    } catch (err: any) {
      console.error("OCR Error:", err);
      const errorMessage = String(err?.message || err || 'Error processing documents.');
      setOcrText(`**Error:** ${errorMessage}`);
    } finally {
      setIsOCRProcessing(false);
    }
  };
  const handleStartPipeline = () => {
    setIsProcessing(true);
    setTimeout(() => setIsProcessing(false), 3000);
  };
  const handleAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isAuthenticating) return;
    
    setIsAuthenticating(true);
    setAuthError(null);
    
    const formData = new FormData(e.currentTarget);
    const email = (formData.get('email') as string)?.toLowerCase().trim();
    const password = formData.get('password');
    const displayName = formData.get('displayName');
    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const payload = authMode === 'signup' ? { email, password, displayName } : { email, password };
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response received:", text.slice(0, 200));
        throw new Error("Server communication error. Please ensure the backend is running.");
      }
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "Email already registered") {
          setAuthError("This clinical email is already registered. Please login to your existing node.");
          setAuthMode('login');
          return;
        }
        throw new Error(data.error || 'Authentication failed');
      }
      localStorage.setItem('matrix_user', JSON.stringify(data.user));
      localStorage.setItem('matrix_token', data.token);
      setUser(data.user);
      setToken(data.token);
    } catch (err: any) {
      console.error("Auth failed:", err);
      setAuthError(err.message || "Authentication failed. Please try again.");
    } finally {
      setIsAuthenticating(false);
    }
  };
  const handleLogout = () => {
    localStorage.removeItem('matrix_user');
    localStorage.removeItem('matrix_token');
    setUser(null);
    setToken(null);
    setActiveTab('dashboard');
  };
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex flex-col items-center justify-center space-y-6">
        <div className="h-16 w-16 relative">
          <div className="absolute inset-0 rounded-full border-t-2 border-blue-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-b-2 border-indigo-500 animate-spin-reverse" />
          <Brain className="absolute inset-0 m-auto h-6 w-6 text-blue-500" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-xs font-black text-white uppercase tracking-[0.3em] font-mono">Initializing Neural Grid</p>
          <div className="h-0.5 w-48 bg-zinc-900 rounded-full overflow-hidden">
            <motion.div 
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="h-full w-1/2 bg-blue-500"
            />
          </div>
        </div>
      </div>
    );
  }
   if (!user) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex flex-col items-center justify-center p-6 relative overflow-hidden medical-grid">
         <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-blue-600/[0.05] blur-[140px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
         <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/[0.04] blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />
         
         <motion.div 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="glass max-w-lg w-full rounded-[3rem] p-12 border border-white/5 space-y-10 relative z-10 shadow-[0_50px_100px_rgba(0,0,0,0.5)]"
         >
           <div className="flex flex-col items-center space-y-4">
              <div className="h-20 w-20 rounded-3xl bg-zinc-950 flex items-center justify-center border border-white/10 shadow-2xl">
                 <Brain className="h-10 w-10 text-blue-500" />
              </div>
              <div className="text-center">
                 <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic">Mortality Matrix</h1>
                 <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mt-2">Analytical Surveillance System</p>
              </div>
           </div>
           <form onSubmit={handleAuth} className="space-y-4">
              {authError && (
                <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-xl">
                  <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider text-center">{authError}</p>
                </div>
              )}
              {authMode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest ml-1">Full Name</label>
                  <input 
                    name="displayName"
                    type="text" 
                    required
                    placeholder="Enter your clinical designation" 
                    className="w-full bg-zinc-900/50 border border-white/5 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-700"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest ml-1">Clinical Email</label>
                <input 
                  name="email"
                  type="email" 
                  required
                  placeholder="name@matrix.clinical" 
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-700"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest ml-1">Access Token (Password)</label>
                <input 
                  name="password"
                  type="password" 
                  required
                  placeholder="••••••••" 
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-700"
                />
              </div>
              <button 
                type="submit"
                disabled={isAuthenticating}
                className={cn(
                  "w-full flex items-center justify-center gap-3 bg-white text-black font-black py-4 rounded-2xl transition-all uppercase tracking-[0.2em] text-[10px] group mt-4",
                  isAuthenticating ? "opacity-50 cursor-not-allowed" : "hover:bg-zinc-200"
                )}
              >
                {isAuthenticating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                )}
                {isAuthenticating ? "Initializing Secure Handshake..." : authMode === 'login' ? "Authenticate Access" : "Create New Node"}
              </button>
              <div className="text-center pt-2">
                <button 
                  type="button"
                  onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }}
                  className="text-[9px] text-zinc-500 hover:text-blue-400 font-bold uppercase tracking-widest transition-colors"
                >
                  {authMode === 'login' ? "Need a clinical node? Sign up here" : "Return to authentication portal"}
                </button>
              </div>
              <p className="text-[10px] text-center text-zinc-600 font-bold uppercase tracking-widest pt-4">Authorized Personnel Only • Secure 256-bit Node</p>
           </form>
         </motion.div>
      </div>
    );
  }
  return (
    <div className="flex h-screen overflow-hidden text-zinc-300">
      {/* Sidebar - Refined with better active states */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="flex flex-col border-r border-white/5 bg-zinc-950/50 backdrop-blur-xl transition-all duration-300 z-50"
      >
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 border border-white/10">
                <Brain className="h-5 w-5 text-blue-500" />
              </div>
            </div>
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="font-sans font-bold tracking-tight text-white text-base leading-none uppercase">Mortality</span>
                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.1em] mt-1">Analysis System</span>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 space-y-2 px-4 py-6 overflow-y-auto custom-scrollbar">
          <div className="mb-4 px-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Navigational Grid</div>
          {NAVIGATION_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-bold transition-all duration-300 relative overflow-hidden",
                activeTab === item.id 
                  ? "bg-blue-600/10 text-white border border-blue-500/20" 
                  : "text-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-200"
              )}
            >
              <div className={cn(
                "absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity",
                activeTab === item.id && "opacity-100"
              )} />
              <item.icon className={cn(
                "h-5 w-5 shrink-0 transition-all duration-500 z-10",
                activeTab === item.id ? "text-blue-400 scale-110" : "text-zinc-500 group-hover:text-zinc-300"
              )} />
              {isSidebarOpen && <span className="relative z-10">{item.label}</span>}
              {activeTab === item.id && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full shadow-[0_0_12px_rgba(59,130,246,0.5)]" 
                />
              )}
            </button>
          ))}
          {isSidebarOpen && (
            <div className="mt-8 space-y-4 pt-8 border-t border-white/5">
              <div className="px-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Live Data Streams</div>
              <div className="space-y-3">
                {DATA_STREAMS.map((stream) => (
                  <div key={stream.id} className="px-4 flex items-center justify-between group/stream cursor-default">
                    <div className="flex items-center gap-3">
                       <div className={cn(
                         "h-1.5 w-1.5 rounded-full transition-all duration-500",
                         stream.active ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-zinc-800"
                       )} />
                       <span className="text-[11px] font-bold text-zinc-500 group-hover/stream:text-zinc-300 transition-colors">{stream.label}</span>
                    </div>
                    <span className="text-[10px] font-mono font-black text-zinc-700">{stream.load}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>
        <div className="p-4 border-t border-white/5">
           <div className="glass rounded-[2rem] p-6 border border-white/5 space-y-4 relative overflow-hidden group">
              <div className="absolute inset-0 bg-green-500/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex flex-col relative z-10">
                <span className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.2em]">Operational Health</span>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[11px] font-black text-white uppercase tracking-tight">Active Matrix</span>
                </div>
              </div>
              <div className="h-1 w-full bg-zinc-950 rounded-full overflow-hidden relative z-10">
                <motion.div 
                  animate={{ width: ['20%', '100%', '20%'] }}
                  transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                  className="h-full bg-green-500/30 blur-[1px]" 
                />
              </div>
           </div>
        </div>
      </motion.aside>
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-zinc-950 relative medical-grid">
        <BackgroundTaskMonitor
          tasks={
            isOCRProcessing
              ? [
                  {
                    id: 'ocr',
                    name: 'Clinical OCR Pipeline',
                    progress: 35,
                    status: 'processing',
                    startTime: Date.now(),
                  },
                ]
              : []
          }
          onRemoveTask={() => {}}
        />
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-blue-600/[0.03] blur-[140px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/[0.02] blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />
        
        {/* Top Header */}
        <header className="flex h-16 items-center justify-between border-b border-white/[0.06] px-8 z-20 bg-zinc-950/60 backdrop-blur-md">
          <div className="flex items-center gap-4 flex-1 max-w-2xl">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 text-zinc-500 hover:text-white transition-all hover:bg-zinc-900"
            >
              <LayoutDashboard className={cn("h-4 w-4 transition-transform duration-300", !isSidebarOpen && "rotate-180")} />
            </button>
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input 
                type="text" 
                placeholder="Search risk vectors or bio-identities..." 
                className="w-full rounded-xl border border-white/5 bg-zinc-900/40 py-2 pl-10 pr-4 text-xs font-medium outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-600"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden xl:flex items-center gap-3 px-4 py-1.5 rounded-xl border border-white/[0.05] bg-zinc-900/20">
               <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
               <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight">Syncing Grid</span>
            </div>
            
          <div className="flex items-center gap-4">
            <button className="relative rounded-lg p-2 text-zinc-500 hover:text-white transition-all hover:bg-zinc-900" title="Notifications">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-600" />
            </button>
            
            <div className="flex items-center gap-4 pl-4 border-l border-white/10">
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-bold text-white tracking-tight leading-none">{user?.displayName || 'User Session'}</p>
                  <p className="text-[9px] text-zinc-600 mt-1 uppercase font-mono tracking-widest font-bold">Clinical Overseer</p>
                </div>
                <div className="h-9 w-9 rounded-lg overflow-hidden ring-1 ring-white/10">
                   <img src={user?.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.email || 'default'}`} alt="User" />
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 text-zinc-500 hover:text-red-400 transition-all hover:bg-red-400/5"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          </div>
        </header>
        {/* Dynamic Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar relative z-10">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                  hidden: { opacity: 0 },
                  visible: { 
                    opacity: 1,
                    transition: { staggerChildren: 0.05 }
                  },
                  exit: { opacity: 0, scale: 0.98 }
                }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                  {SYSTEM_STATS.map((stat, i) => (
                    <motion.div 
                      key={i} 
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 }
                      }}
                      className="glass rounded-2xl p-6 border border-white/5 space-y-4 hover:bg-zinc-900/40 transition-all group cursor-default"
                    >
                      <div className="flex items-center justify-between">
                        <div className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center border",
                          stat.color === 'green' ? "bg-green-500/5 border-green-500/10 text-green-500/80" :
                          stat.color === 'red' ? "bg-red-500/5 border-red-500/10 text-red-500/80" :
                          stat.color === 'blue' ? "bg-blue-500/5 border-blue-500/10 text-blue-500/80" :
                          "bg-zinc-500/5 border-white/10 text-zinc-500"
                        )}>
                          {stat.label.includes('Processed') && <FileText className="h-5 w-5" />}
                          {stat.label.includes('Alerts') && <AlertCircle className="h-5 w-5" />}
                          {stat.label.includes('Preventability') && <TrendingUp className="h-5 w-5" />}
                          {stat.label.includes('Uptime') && <Activity className="h-5 w-5" />}
                        </div>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold tracking-tight uppercase",
                          stat.trend === 'up' ? "text-green-500/70" :
                          stat.trend === 'down' ? "text-red-500/70" :
                          "text-zinc-500"
                        )}>
                          {stat.change}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-3xl font-bold text-white tracking-tight leading-none">{stat.value}</h3>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-none">{stat.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <motion.div 
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    visible: { opacity: 1, y: 0 }
                  }}
                  className="glass rounded-3xl p-8 border border-white/5 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-white">System Feed</h3>
                      <p className="text-xs text-zinc-500 mt-1">Real-time analytical progression and event logs</p>
                    </div>
                    <button className="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest border border-white/5 px-4 py-2 rounded-lg">View Full Audit</button>
                  </div>
                  <div className="space-y-2">
                    {RECENT_ACTIVITY.map((activity, idx) => (
                      <div 
                        key={activity.id}
                        className="flex items-center justify-between p-4 rounded-xl hover:bg-zinc-900/30 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                           <div className="h-9 w-9 rounded-lg bg-zinc-950 flex items-center justify-center border border-white/5">
                              {activity.title.includes('Scan') ? <FileSearch className="h-4 w-4 text-zinc-500" /> : 
                               activity.title.includes('Analysis') ? <Brain className="h-4 w-4 text-zinc-500" /> :
                               <Activity className="h-4 w-4 text-zinc-500" />}
                           </div>
                           <div className="flex flex-col">
                             <h4 className="text-sm font-bold text-white/90 group-hover:text-blue-400 transition-colors">{activity.title}</h4>
                             <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tight">{activity.subtitle}</p>
                           </div>
                        </div>
                        <div className="flex items-center gap-8">
                          <span className="text-[10px] text-zinc-600 font-mono font-bold whitespace-nowrap">{activity.time}</span>
                          <span className={cn(
                            "px-3 py-1 rounded-lg text-[9px] font-bold tracking-widest uppercase",
                            activity.statusColor === 'orange' ? "bg-orange-500/5 text-orange-500/80 border border-orange-500/10" :
                            activity.statusColor === 'red' ? "bg-red-500/5 text-red-500/80 border border-red-500/10" :
                            activity.statusColor === 'green' ? "bg-green-500/5 text-green-500/80 border border-green-500/10" :
                            "bg-zinc-800/5 text-zinc-500 border border-white/5"
                          )}>
                            {activity.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
            {activeTab === 'upload' && (
              <motion.div
                key="upload"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { 
                    opacity: 1, 
                    y: 0,
                    transition: { staggerChildren: 0.1 }
                  },
                  exit: { opacity: 0, y: -20 }
                }}
                className="space-y-12 pb-20"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Records Ingestion</h1>
                  <p className="text-sm text-zinc-500 font-medium">Multi-modal clinical data absorption pipeline</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                </div>
              </motion.div>
            )}
            {activeTab === 'analysis' && (
              <motion.div
                key="analysis"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                  hidden: { opacity: 0 },
                  visible: { 
                    opacity: 1,
                    transition: { staggerChildren: 0.1 }
                  },
                  exit: { opacity: 0 }
                }}
                className="space-y-12"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Mortality Analysis</h1>
                  <p className="text-sm text-zinc-500 font-medium">Predictive mortality modeling and clinical trajectory mapping</p>
                </div>
                <motion.div 
                  variants={{
                    hidden: { opacity: 0, scale: 0.98 },
                    visible: { opacity: 1, scale: 1 }
                  }}
                  className="glass rounded-[3rem] p-10 border border-white/5 bg-gradient-to-br from-zinc-950/40 to-zinc-950/10 flex flex-col lg:flex-row items-center gap-12 relative overflow-hidden group shadow-[0_30px_60px_rgba(0,0,0,0.4)]"
                >
                   <div className="absolute inset-0 bg-blue-600/[0.01] group-hover:bg-blue-600/[0.03] transition-colors" />
                      <div className="h-48 w-48 relative flex items-center justify-center shrink-0">
                        <PieChart width={192} height={192}>
                          <Pie
                            data={[
                              { value: selectedCase?.risk_score || 45, fill: (selectedCase?.risk_score || 45) > 70 ? '#ef4444' : (selectedCase?.risk_score || 45) > 40 ? '#f59e0b' : '#3b82f6' },
                              { value: 100 - (selectedCase?.risk_score || 45), fill: 'rgba(255,255,255,0.03)' }
                            ]}
                            innerRadius={70}
                            outerRadius={90}
                            startAngle={225}
                            endAngle={-45}
                            dataKey="value"
                            stroke="none"
                            cornerRadius={10}
                          />
                        </PieChart>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
                         <span className={cn(
                            "text-6xl font-black tracking-tighter leading-none",
                            (selectedCase?.risk_score || 45) > 70 ? "text-red-500" : (selectedCase?.risk_score || 45) > 40 ? "text-amber-500" : "text-blue-500"
                         )}>
                            {selectedCase?.risk_score || 45}
                         </span>
                         <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mt-1">Score Index</span>
                      </div>
                   </div>
                   <div className="flex-1 space-y-6 text-center lg:text-left">
                      <div className="space-y-1">
                         <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4">
                            <h2 className="text-4xl font-black text-white tracking-tight">Clinical Priority: {(selectedCase?.risk_score || 45) > 70 ? "CRITICAL" : (selectedCase?.risk_score || 45) > 40 ? "ELEVATED" : "STABLE"}</h2>
                            <div className={cn(
                               "px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-[0.2em] animate-pulse",
                               (selectedCase?.risk_score || 45) > 70 ? "bg-red-500/20 border-red-500/30 text-red-400" : (selectedCase?.risk_score || 45) > 40 ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                            )}>
                               {(selectedCase?.risk_score || 45) > 70 ? "Emergency Intervention Required" : (selectedCase?.risk_score || 45) > 40 ? "Increased Surveillance" : "Routine Observation Outpatient"}
                            </div>
                         </div>
                         <p className="text-xl text-zinc-500 font-medium italic opacity-80 mt-2 max-w-2xl">
                            The current mortality risk score is driven by {(selectedCase?.risk_score || 45) > 60 ? "acute physiological disturbances and high-consequence diagnostics." : "stable longitudinal vitals and consistent treatment adherence."}
                         </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center lg:justify-start gap-10">
                         <div className="space-y-1">
                            <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest leading-none">Model Confidence</p>
                            <p className="text-lg font-bold text-white uppercase tracking-tight">98.4% AccuMatrix</p>
                         </div>
                         <div className="h-10 w-px bg-white/5 hidden lg:block" />
                         <div className="space-y-1">
                            <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest leading-none">AI Observation</p>
                            <p className="text-lg font-bold text-blue-400 uppercase tracking-tight">Real-time Streamed</p>
                         </div>
                         <div className="h-10 w-px bg-white/5 hidden lg:block" />
                         <div className="space-y-1">
                            <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest leading-none">Status Code</p>
                            <p className="text-lg font-bold text-white uppercase tracking-tight">Active_Triage_v3</p>
                         </div>
                      </div>
                   </div>
                </motion.div>
                {/* Detailed Clinical Timeline Section */}
                <motion.div 
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 }
                  }}
                  className="glass rounded-[3rem] p-12 border border-white/5 bg-zinc-950/20 space-y-12 shadow-[0_20px_50px_rgba(0,0,0,0.3)]"
                >
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-2">
                       <h3 className="text-4xl font-black text-white tracking-tighter uppercase italic">Chronological Intel</h3>
                       <div className="flex items-center gap-3">
                          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.4em] font-mono">Real-time Clinical Narrative Reconstruction</p>
                       </div>
                    </div>
                    <div className="flex gap-4">
                       <button className="px-6 py-2 rounded-xl bg-zinc-900 border border-white/5 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:border-white/20 hover:text-white transition-all">Filter Events</button>
                       <button className="px-6 py-2 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all">Export JSON</button>
                    </div>
                  </div>
                  <div className="relative pl-12 md:pl-24 space-y-16">
                    {/* Vertical Timeline Track */}
                    <div className="absolute left-[20px] md:left-[31px] top-4 bottom-4 w-px bg-gradient-to-b from-blue-500/50 via-zinc-800 to-transparent" />
                    
                    {selectedCase?.timeline?.length > 0 ? (
                      selectedCase.timeline.map((entry: any, i: number) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.1 }}
                          className="relative group"
                        >
                          {/* Indicator Dot */}
                          <div className="absolute -left-[32px] md:-left-[43px] top-2 h-4 w-4 bg-zinc-950 border-2 border-blue-500 rounded-full z-10 group-hover:scale-125 transition-transform shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                          
                          <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-16">
                            <div className="shrink-0 md:w-32 pt-1">
                               <p className="text-xs font-black text-zinc-600 font-mono uppercase tracking-widest">{entry.time || 'N/A'}</p>
                            </div>
                            <div className="space-y-3 flex-1">
                              <div className="flex items-center gap-4">
                                <h4 className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors tracking-tight">{entry.title}</h4>
                                <div className="h-px flex-1 bg-white/[0.03] hidden md:block" />
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
                                  (entry.title || '').toLowerCase().includes('diagnosis') ? "bg-purple-500/10 border-purple-500/20 text-purple-400" :
                                  (entry.title || '').toLowerCase().includes('procedure') ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                                  (entry.title || '').toLowerCase().includes('med') ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                                  "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                )}>
                                  {(entry.title || '').toLowerCase().includes('diag') ? 'Diagnostic' : (entry.title || '').toLowerCase().includes('proc') ? 'Procedural' : 'Clinical'}
                                </span>
                              </div>
                              <p className="text-lg text-zinc-400/70 font-medium leading-relaxed max-w-4xl tracking-tight">
                                {entry.subtitle}
                              </p>
                              {/* Meta Details for i-th entry */}
                              <div className="flex gap-8 pt-4">
                                 <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Source: EMR Cluster Alpha</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Verified: MD Consensus</span>
                                 </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="h-16 w-16 rounded-3xl bg-zinc-900 flex items-center justify-center border border-white/5">
                           <Activity className="h-8 w-8 text-zinc-700" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-white font-bold">No Chronological Data Stream</p>
                          <p className="text-xs text-zinc-500">Run clinical document analysis to reconstruct the timeline.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <motion.div 
                    variants={{
                      hidden: { opacity: 0, x: -20 },
                      visible: { opacity: 1, x: 0 }
                    }}
                    className="space-y-8"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                        <Brain className="h-7 w-7 text-blue-400" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">AI Observation Engine</h2>
                        <p className="text-sm text-zinc-500 font-mono">EXTRACTED CORE METADATA</p>
                      </div>
                    </div>
                    <div className="glass rounded-[32px] border border-white/5 p-8 space-y-8 relative overflow-hidden">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Users className="h-4 w-4 text-blue-500" />
                          <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">Bio-Identity Summary</h3>
                        </div>
                        <div className="flex gap-2">
                           <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                           <span className="text-[9px] font-bold text-green-500 uppercase">Live Feed</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        {[
                          { label: 'Name', value: selectedPatient?.name || PATIENT_DATA.name },
                          { label: 'Age', value: selectedPatient?.age || PATIENT_DATA.age },
                          { label: 'Registry MRN', value: selectedPatient?.mrn || PATIENT_DATA.mrn },
                          { label: 'Admission', value: selectedPatient?.admission_date || PATIENT_DATA.admissionDate }
                        ].map((item, i) => (
                          <div key={i} className="space-y-1">
                            <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">{item.label}</p>
                            <p className="text-lg font-bold text-white tracking-tight">{item.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-6 border-t border-white/5">
                        <div className="flex items-center gap-3 mb-6">
                          <FileText className="h-4 w-4 text-indigo-500" />
                          <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">Clinical Findings</h3>
                        </div>
                        <div className="space-y-4">
                          {(selectedCase?.findings || PATIENT_DATA.findings).map((item: any, i: number) => (
                            <div key={i} className="flex justify-between items-center p-4 rounded-xl border border-white/[0.03] bg-zinc-900/20 group hover:bg-zinc-900/40 transition-all">
                              <div className="space-y-1">
                                <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">{item.label}</p>
                                <p className="text-lg font-bold text-white tracking-tight">{item.value}</p>
                              </div>
                              <div className="h-7 w-7 rounded-lg bg-green-500/5 flex items-center justify-center border border-green-500/10">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500/80" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {selectedCase?.summary && (
                        <div className="pt-6 border-t border-white/5">
                          <div className="flex items-center gap-3 mb-4">
                            <FileText className="h-4 w-4 text-indigo-500" />
                            <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">Document Summary</h3>
                          </div>
                          <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-line">{selectedCase.summary}</p>
                        </div>
                      )}
                      {selectedCase?.transcript?.length > 0 && (
                        <div className="pt-6 border-t border-white/5">
                          <div className="flex items-center gap-3 mb-4">
                            <FileSearch className="h-4 w-4 text-blue-400" />
                            <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">Document Transcript</h3>
                          </div>
                          <div className="space-y-4 max-h-64 overflow-y-auto pr-2 text-xs text-zinc-300 leading-relaxed">
                            {selectedCase.transcript.map((page: any, idx: number) => (
                              <div key={`${page.fileName}-${page.page}-${idx}`} className="rounded-2xl border border-white/5 bg-zinc-950/80 p-4">
                                <div className="mb-2 text-[10px] uppercase text-zinc-500 tracking-[0.3em]">{page.fileName} • Page {page.page}</div>
                                <div className="space-y-1">
                                  {(page.lines ?? []).length > 0 ? (() => {
                                    const normalize = (text: string): string => {
                                      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
                                      if (!t) return '';
                                      if (/[.!?]$/.test(t)) return t;
                                      return `${t}.`;
                                    };
                                    // Join this page into a single paragraph (no word-by-word / line-by-line output)
                                    const paragraph = (page.lines ?? [])
                                      .map((line: any) => normalize(line.text))
                                      .filter(Boolean)
                                      .join(' ');
                                    return paragraph ? <p className="whitespace-pre-wrap">{paragraph}</p> : null;
                                  })() : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                  <motion.div 
                    variants={{
                      hidden: { opacity: 0, x: 20 },
                      visible: { opacity: 1, x: 0 }
                    }}
                    className="space-y-8"
                  >
                    <div className="glass rounded-[32px] border border-white/5 p-8 h-[400px] flex flex-col relative group">
                      <div className="flex items-center justify-between mb-8">
                        <div className="space-y-1">
                          <h3 className="text-lg font-bold text-white">Vital Signs Stream</h3>
                          <p className="text-[10px] text-zinc-600 font-bold tracking-widest uppercase">72H Analytical View</p>
                        </div>
                        <button className="p-2 rounded-lg border border-white/5 text-zinc-500 hover:text-white transition-all">
                          <Maximize2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex-1 mt-6 h-[300px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={10}>
                          <AreaChart data={vitalsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis dataKey="time" stroke="#3f3f46" fontSize={10} axisLine={false} tickLine={false} dy={10} />
                            <YAxis stroke="#3f3f46" fontSize={10} axisLine={false} tickLine={false} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#09090b', border: '1px solid #ffffff10', borderRadius: '12px' }}
                              itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                            />
                            <Area type="monotone" dataKey="hr" stroke="#8b5cf6" strokeWidth={2} fill="transparent" name="Heart Rate" />
                            <Area type="monotone" dataKey="bp" stroke="#3b82f6" strokeWidth={2} fill="transparent" name="Systolic BP" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="glass rounded-[32px] border border-white/5 p-8 h-[350px] flex flex-col group overflow-hidden">
                      <div className="space-y-1 mb-8">
                        <h3 className="text-lg font-bold text-white">Laboratory Diagnostics</h3>
                        <p className="text-[10px] text-zinc-600 font-bold tracking-widest uppercase">Serum analysis metrics</p>
                      </div>
                      <div className="flex-1 h-[250px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={10}>
                          <BarChart data={labData} margin={{ left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis dataKey="name" stroke="#3f3f46" fontSize={10} axisLine={false} tickLine={false} dy={10} />
                            <Bar dataKey="value" radius={[4, 4, 4, 4]} barSize={32}>
                               {labData.map((entry, index) => (
                                 <Cell key={`cell-${index}`} fill={index === 0 ? '#3b82f6' : '#27272a'} />
                               ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}
            {activeTab === 'timeline' && (
              <motion.div
                key="timeline"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                  hidden: { opacity: 0 },
                  visible: { 
                    opacity: 1,
                    transition: { staggerChildren: 0.1 }
                  },
                  exit: { opacity: 0, y: -10 }
                }}
                className="space-y-12 pb-20"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Clinical Progression</h1>
                  <p className="text-sm text-zinc-500 font-medium">Temporal mapping of patient events and mortality trajectory</p>
                </div>
                <div className="max-w-4xl mx-auto py-10 relative">
                  <div className="absolute left-[39px] top-0 bottom-0 w-[2px] bg-white/[0.03]" />
                  
                  <div className="space-y-12">
                    {(selectedCase?.timeline || [
                      { title: 'Patient Admission', subtitle: 'Emergency department - Chest pain complaint', time: 'Apr 20, 08:30', icon: Activity, color: 'blue' },
                      { title: 'Vital Signs Recorded', subtitle: 'BP: 145/92, HR: 88, Temp: 98.6°F', time: 'Apr 20, 09:15', icon: TrendingUp, color: 'orange' },
                      { title: 'Medication Administered', subtitle: 'Aspirin 325mg - Antiplatelet therapy', time: 'Apr 20, 10:00', icon: Shield, color: 'red', alert: 'Interaction check active' },
                      { title: 'ECG Performed', subtitle: 'Standard 12-lead electrocardiogram', time: 'Apr 20, 10:30', icon: Activity, color: 'green' },
                      { title: 'Medication Update', subtitle: 'Warfarin 5mg - Anticoagulant (interaction alert)', time: 'Apr 20, 14:00', icon: ShieldAlert, color: 'red', alert: 'Requires clinical oversight' }
                    ]).map((event: any, i: number) => {
                      const IconComp = event.icon || (i === 0 ? Activity : i % 2 === 0 ? Shield : TrendingUp);
                      return (
                      <motion.div 
                        key={i} 
                        variants={{
                          hidden: { opacity: 0, x: -20 },
                          visible: { opacity: 1, x: 0 }
                        }}
                        className="relative pl-32 group"
                      >
                        <div className={cn(
                          "absolute left-0 top-0 h-20 w-20 rounded-[2rem] border border-white/5 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:shadow-[0_0_40px_rgba(var(--color-glow),0.15)] z-10",
                          event.color === 'red' || event.alert ? "bg-red-500/10 border-red-500/30 text-red-400" :
                          event.color === 'orange' ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
                          event.color === 'green' ? "bg-green-500/10 border-green-500/30 text-green-400" :
                          "bg-blue-500/10 border-blue-500/30 text-blue-400"
                        )}>
                          <IconComp className="h-8 w-8" />
                        </div>
                        
                        <div className={cn(
                          "glass rounded-[2.5rem] p-10 border border-white/5 space-y-4 transition-all duration-500 relative overflow-hidden",
                          event.alert || event.level === 'Critical' ? "border-red-500/20 bg-red-500/[0.02]" : "group-hover:border-white/10"
                        )}>
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                            <div className="space-y-1">
                               <h3 className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors tracking-tight">{event.title}</h3>
                               <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest leading-none">{event.time}</p>
                            </div>
                            <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-full border border-white/5 bg-zinc-950/50">Logged Event</span>
                          </div>
                          <p className="text-zinc-400 text-lg leading-relaxed max-w-2xl">{event.subtitle}</p>
                          {(event.alert || event.level) && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn(
                                "flex items-center gap-3 mt-6 px-4 py-3 rounded-2xl border w-fit",
                                event.level === 'Critical' || event.alert ? "text-red-500 bg-red-500/10 border-red-500/20" : "text-orange-500 bg-orange-500/10 border-orange-500/20"
                               )}
                            >
                              <AlertCircle className="h-4 w-4" />
                              <span className="text-xs font-black uppercase tracking-widest">{event.alert || event.level}</span>
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    );})}
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'risk' && (
              <motion.div
                key="risk"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                  hidden: { opacity: 0 },
                  visible: { 
                    opacity: 1,
                    transition: { staggerChildren: 0.1 }
                  },
                  exit: { opacity: 0 }
                }}
                className="space-y-12"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Risk Modeling</h1>
                  <p className="text-sm text-zinc-500 font-medium">Advanced mortality risk estimation and clinical avoidability</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-8">
                    <div className="flex justify-between items-end mb-6">
                      <h2 className="text-2xl font-bold text-white tracking-tight">Active Indicators</h2>
                      <span className="text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-widest leading-none">REAL-TIME SIGNAL FEED</span>
                    </div>
                    <div className="space-y-6">
                      {(selectedCase?.alerts || [
                        { title: 'Medication Interaction Detected', subtitle: 'Warfarin and Aspirin combination increases bleeding risk significantly', time: '2 mins ago', color: 'red', level: 'Critical' },
                        { title: 'Abnormal Vital Signs Pattern', subtitle: 'Blood pressure trending upward over 72 hours indicative of hypertension', time: '15 mins ago', color: 'orange', level: 'Elevated' },
                        { title: 'Treatment Deviation', subtitle: 'Antibiotic dosage outside protocol guidelines for patient weight', time: '1 hour ago', color: 'purple', level: 'Moderate' }
                      ]).map((alert: any, i: number) => (
                        <motion.div 
                          key={i} 
                          variants={{
                            hidden: { opacity: 0, x: -20 },
                            visible: { opacity: 1, x: 0 }
                          }}
                          className={cn(
                            "relative glass rounded-[2.5rem] p-10 border-l-[16px] overflow-hidden group hover:bg-zinc-900/50 transition-all",
                            alert.level === 'Critical' || alert.color === 'red' ? "border-l-red-500/40 bg-red-500/[0.03]" :
                            alert.level === 'Elevated' || alert.color === 'orange' ? "border-l-orange-500/40 bg-orange-500/[0.03]" :
                            "border-l-purple-500/40 bg-purple-500/[0.03]"
                          )}
                        >
                          <div className="flex justify-between items-start mb-4">
                             <div className="space-y-1">
                                <h4 className="text-2xl font-bold text-white group-hover:text-zinc-100 transition-colors tracking-tight">{alert.title}</h4>
                                <div className="flex gap-4 items-center">
                                  <span className="text-xs text-zinc-600 font-mono font-bold tracking-tight">{alert.time || 'AI Analysis'}</span>
                                  <span className={cn(
                                    "px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.2em]",
                                    alert.level === 'Critical' || alert.color === 'red' ? "bg-red-500/20 text-red-400" :
                                    alert.level === 'Elevated' || alert.color === 'orange' ? "bg-orange-500/20 text-orange-400" :
                                    "bg-purple-500/20 text-purple-400"
                                  )}>{alert.level || 'Active'}</span>
                                </div>
                             </div>
                             <div className="h-10 w-10 rounded-2xl bg-zinc-950 flex items-center justify-center border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ChevronRight className="h-5 w-5 text-white" />
                             </div>
                          </div>
                          <p className="text-xl text-zinc-400/80 leading-relaxed italic">{alert.subtitle}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                    <div className="space-y-8">
                      <motion.div 
                        variants={{
                          hidden: { opacity: 0, scale: 0.95 },
                          visible: { opacity: 1, scale: 1 }
                        }}
                        className="glass rounded-[3rem] p-12 border border-white/5 flex flex-col items-center space-y-12 text-center relative overflow-hidden group min-h-[600px] justify-between"
                      >
                         <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                         
                         <div className="space-y-2 relative z-10 w-full text-center">
                            <h3 className="text-3xl font-bold text-white tracking-tight">Clinical Risk Index</h3>
                            <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest font-mono">Real-time Mortality Prediction</p>
                         </div>
                         
                         <div className="relative h-80 w-80 flex items-center justify-center shrink-0">
                              <PieChart width={320} height={320}>
                                <Pie
                                  data={[
                                    { value: selectedCase?.risk_score || 45, fill: (selectedCase?.risk_score || 45) > 70 ? '#ef4444' : (selectedCase?.risk_score || 45) > 40 ? '#f59e0b' : '#3b82f6' },
                                    { value: 100 - (selectedCase?.risk_score || 45), fill: 'rgba(255,255,255,0.03)' }
                                  ]}
                                  innerRadius={100}
                                  outerRadius={140}
                                  startAngle={225}
                                  endAngle={-45}
                                  dataKey="value"
                                  stroke="none"
                                  cornerRadius={20}
                                />
                              </PieChart>
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.3 }}
                              className="absolute inset-0 flex flex-col items-center justify-center pt-4"
                            >
                               <span className={cn(
                                 "text-9xl font-black tracking-tighter drop-shadow-2xl transition-colors",
                                 (selectedCase?.risk_score || 45) > 70 ? "text-red-500" : (selectedCase?.risk_score || 45) > 40 ? "text-amber-500" : "text-blue-500"
                               )}>
                                 {selectedCase?.risk_score || 45}
                               </span>
                               <div className="flex items-center gap-2 mt-[-10px]">
                                 <span className="text-xs text-zinc-600 font-black uppercase tracking-[0.3em]">Acquity Level</span>
                               </div>
                            </motion.div>
                         </div>
                         <div className="grid grid-cols-2 gap-10 w-full relative z-10 bg-white/[0.02] p-8 rounded-[2rem] border border-white/5 mx-auto">
                            <div className="text-center space-y-1 border-r border-white/5">
                               <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest leading-none">Triage Zone</p>
                               <p className={cn(
                                 "text-xl font-bold uppercase tracking-tight",
                                 (selectedCase?.risk_score || 45) > 70 ? "text-red-400" : (selectedCase?.risk_score || 45) > 40 ? "text-amber-400" : "text-emerald-400"
                               )}>
                                 {(selectedCase?.risk_score || 45) > 70 ? "Critical" : (selectedCase?.risk_score || 45) > 40 ? "Elevated" : "Normal"}
                               </p>
                            </div>
                            <div className="text-center space-y-1">
                               <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest leading-none">AI Confidence</p>
                               <div className="flex items-center justify-center gap-2">
                                  <p className="text-xl font-bold text-white font-mono">98.4%</p>
                                  <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                               </div>
                            </div>
                         </div>
                      </motion.div>
                    </div>
                  </div>
                  <div className="space-y-6">
                      <div className="flex items-center justify-between">
                         <h3 className="text-2xl font-bold text-white font-serif italic">Avoidability Scores</h3>
                         <TrendingUp className="h-5 w-5 text-zinc-700" />
                      </div>
                      <div className="grid grid-cols-1 gap-6">
                        {[
                          { label: 'Medication Adherence', score: 72, color: 'red', desc: 'Patient missed 2 doses in last 48 hours' },
                          { label: 'Protocol Compliance', score: 85, color: 'green', desc: 'Treatment plan follows standard guidelines' }
                        ].map((factor, i) => (
                          <motion.div 
                            key={i} 
                            variants={{
                              hidden: { opacity: 0, x: 20 },
                              visible: { opacity: 1, x: 0 }
                            }}
                            className="glass rounded-[2rem] p-8 border border-white/5 space-y-4 hover:border-white/10 transition-colors group"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-4">
                                <div className={cn(
                                  "h-10 w-10 rounded-2xl flex items-center justify-center border",
                                  factor.color === 'red' ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-green-500/10 border-green-500/20 text-green-500"
                                )}>
                                  {factor.color === 'red' ? <ArrowUpRight className="h-5 w-5 rotate-180" /> : <TrendingUp className="h-5 w-5" />}
                                </div>
                                <span className="text-xl font-bold text-white">{factor.label}</span>
                              </div>
                              <span className="text-4xl font-black text-white">{factor.score}</span>
                            </div>
                            <p className="text-sm text-zinc-500 font-medium leading-relaxed uppercase tracking-tight">{factor.desc}</p>
                            <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden">
                               <motion.div 
                                 initial={{ width: 0 }}
                                 animate={{ width: `${factor.score}%` }}
                                 transition={{ duration: 1.5, delay: 0.3 * i }}
                                 className={cn(
                                   "h-full transition-all duration-1000",
                                   factor.color === 'red' ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" : "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]"
                                 )} 
                               />
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                </motion.div>
            )}
            {activeTab === 'ocr' && (
              <motion.div
                key="ocr"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8 max-w-5xl mx-auto"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Clinical OCR Processor</h1>
                  <p className="text-sm text-zinc-500 font-medium font-mono uppercase tracking-[0.2em]">Neural Vision Document Transcription</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="glass rounded-[2rem] border-2 border-dashed border-white/5 p-12 flex flex-col items-center justify-center space-y-6 bg-zinc-900/10 group hover:border-blue-500/30 transition-all cursor-pointer relative min-h-[300px]">
                      <input 
                        id="file-upload"
                        type="file" 
                        multiple
                        accept="application/pdf,image/jpeg,image/png,image/tiff,application/zip"
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files && files.length > 0) {
                            handleQuickOCR(files);
                          }
                        }}
                      />
                        <input 
                        id="folder-upload"
                        type="file"
                        multiple
                        webkitdirectory=""
                        {...({ directory: "" } as any)}
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files && files.length > 0) {
                            handleQuickOCR(files);
                          }
                        }}
                      />
                      <div className="h-16 w-16 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                        {isOCRProcessing ? <Loader2 className="h-8 w-8 text-blue-500 animate-spin" /> : <Upload className="h-8 w-8 text-zinc-500" />}
                      </div>
                      <div className="text-center space-y-2">
                        <p className="text-white font-bold">{isOCRProcessing ? "Decoding Clinical Data..." : "Upload Clinical Documents"}</p>
                        <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Supports PDF/JPG/PNG/TIFF & ZIP</p>
                        <div className="flex gap-2 mt-4">
                          <label 
                            htmlFor="file-upload"
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded cursor-pointer transition-colors"
                          >
                            Select Files
                          </label>
                          <label 
                            htmlFor="folder-upload"
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded cursor-pointer transition-colors"
                          >
                            Select Folder
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="glass rounded-2xl p-6 border border-white/5 space-y-4">
                      <div className="flex items-center gap-3">
                        <ShieldAlert className="h-4 w-4 text-orange-500" />
                        <h4 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Usage Protocol</h4>
                      </div>
                      <ul className="space-y-2">
                        {[
                          "Ensure handwriting is clearly legible",
                          "Verify neural transcription before integration",
                          "Maintain PII encryption standards",
                          "Signatures detected as binary blobs"
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <div className="h-1 w-1 rounded-full bg-zinc-800 mt-1.5" />
                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-col h-full min-h-[500px]">
                    <div className="glass flex-1 rounded-[2.5rem] border border-white/5 p-8 relative overflow-hidden flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                         <div className="flex items-center gap-2">
                            <Bot className="h-4 w-4 text-blue-500" />
                            <span className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em]">Machine Vision Output</span>
                         </div>
                         {ocrText && (
                           <div className="flex gap-2">
                             <button 
                               onClick={() => {
                                 const names = getPatientNames();
                                 alert(names);
                               }}
                               className="text-[9px] text-zinc-600 hover:text-blue-400 transition-colors font-black uppercase tracking-widest"
                             >
                               Extract Names
                             </button>
                             <button 
                               onClick={() => {
                                 navigator.clipboard.writeText(ocrText);
                               }}
                               className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest"
                             >
                               Copy to Matrix
                             </button>
                             <button
                               type="button"
                               onClick={() => {
                                 setIsTranscriptEditing(true);
                                 setTranscriptDraft(ocrText);
                               }}
                               className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest border border-white/5 px-3 py-1 rounded-lg"
                             >
                               Edit
                             </button>
                             <button
                               type="button"
                               onClick={() => downloadTranscriptAsPdf()}
                               className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest border border-white/5 px-3 py-1 rounded-lg"
                             >
                               Download PDF
                             </button>
                             <button
                               type="button"
                               onClick={() => downloadTextFile('transcript.txt', ocrText)}
                               className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest border border-white/5 px-3 py-1 rounded-lg"
                             >
                               Download
                             </button>


                           </div>
                         )}
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                        {ocrText ? (
                          <div className="space-y-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">Page-wise Clinical OCR Transcript</h3>
                              <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                                {ocrResults?.length ? `Files: ${ocrResults.length}` : 'No OCR pages loaded'}
                              </div>
                            </div>
                            {ocrText && isTranscriptEditing && (
                              <div className="border border-white/10 bg-zinc-950/50 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="text-xs font-bold text-white uppercase tracking-[0.2em]">Transcript Editor</h4>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => downloadTextFile('transcript.txt', transcriptDraft)}
                                      className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest border border-white/5 px-3 py-1 rounded-lg"
                                    >
                                      Download
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsTranscriptEditing(false);
                                        setTranscriptDraft('');
                                      }}
                                      className="text-[9px] text-zinc-600 hover:text-white transition-colors font-black uppercase tracking-widest border border-white/5 px-3 py-1 rounded-lg"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => persistTranscriptEdits()}
                                      className="text-[9px] bg-blue-600 hover:bg-blue-500 text-white transition-colors font-black uppercase tracking-widest px-3 py-1 rounded-lg"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                                <textarea
                                  value={transcriptDraft}
                                  onChange={(e) => setTranscriptDraft(e.target.value)}
                                  className="w-full min-h-[220px] bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-zinc-200 outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20"
                                />
                              </div>
                            )}
                            {ocrResults?.length ? (
                              <div className="space-y-6">
                                {/* Cancel is global for the current UI flow; wire it to any in-progress AI tasks if needed */}
                                <div className="flex items-center justify-end gap-2 mb-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // stop any pending UI processing
                                      setIsProcessing(false);
                                      setIsOCRProcessing(false);
                                      // close assistant if open
                                      setIsAssistantOpen(false);
                                    }}
                                    className="px-3 py-1.5 rounded-lg border border-white/5 bg-zinc-900/40 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  >
                                    Cancel
                                  </button>
                                </div>
                                {ocrResults.map((file) => (
                                  <div key={file.fileName} className="space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <h4 className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">
                                        File: {file.fileName || 'Unknown'}
                                      </h4>
                                      <div className="text-[10px] text-zinc-600 font-mono">
                                        Pages: {file.pages?.length ?? 0}
                                      </div>
                                    </div>
                                    {file.pages?.map((p: any) => {
                                      const pageText = (p.lines ?? [])
                                        .map((l: any) => String(l?.text ?? '').trim())
                                        .filter(Boolean)
                                        .join(' ');
                                      return (
                                        <div key={`p-${file.fileName}-${p.page}`} className="border border-white/5 rounded-2xl p-4 bg-zinc-950/30">
                                          <div className="flex items-baseline justify-between gap-3 mb-2">
                                            <div className="text-sm font-bold text-white tracking-tight">
                                              Page {p.page ?? ''}
                                            </div>
                                            <div className="text-[10px] text-zinc-600 font-mono">
                                              Lines: {(p.lines ?? []).length}
                                            </div>
                                          </div>
                                          <div className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                                            {(() => {
                                              const clinicalTerms = [
                                                'cardiac', 'arrest', 'cpr', 'adrenaline', 'epinephrine',
                                                'heart failure', 'myocardial', 'infarction', 'ischemia',
                                                'stroke', 'seizure', 'sepsis', 'septic', 'pneumonia',
                                                'respiratory', 'respiratory failure', 'intubation',
                                                'oxygen', 'ventilation', 'shock', 'hypotension',
                                                'hypertension', 'dka', 'diabetic ketoacidosis',
                                              ];
                                              const raw = pageText || '';
                                              if (!raw.trim()) return <span className="text-zinc-600">No text extracted.</span>;
                                              const lower = raw.toLowerCase();
                                              const matches = clinicalTerms
                                                .filter((t) => lower.includes(t))
                                                .sort((a, b) => b.length - a.length);
                                              if (!matches.length) return <span>{raw}</span>;
                                              // Highlight by replacing matched terms (simple, case-insensitive).
                                              // Split strategy to avoid over-highlighting too aggressively.
                                              let parts: Array<{ t: string; mark: boolean }> = [{ t: raw, mark: false }];
                                              for (const term of matches.slice(0, 10)) {
                                                const termLower = term.toLowerCase();
                                                parts = parts.flatMap((seg) => {
                                                  if (seg.mark) return [seg];
                                                  const segLower = seg.t.toLowerCase();
                                                  const idx = segLower.indexOf(termLower);
                                                  if (idx === -1) return [seg];
                                                  return [
                                                    { t: seg.t.slice(0, idx), mark: false },
                                                    { t: seg.t.slice(idx, idx + term.length), mark: true },
                                                    { t: seg.t.slice(idx + term.length), mark: false },
                                                  ];
                                                });
                                              }
                                              return (
                                                <span>
                                                  {parts.map((seg, i2) =>
                                                    seg.mark ? (
                                                      <mark
                                                        key={i2}
                                                        className="bg-amber-500/20 text-amber-200 px-1 rounded-sm border border-amber-500/20"
                                                      >
                                                        {seg.t}
                                                      </mark>
                                                    ) : (
                                                      <span key={i2}>{seg.t}</span>
                                                    )
                                                  )}
                                                </span>
                                              );
                                            })()}
                                          </div>
                                          {/* Page summary button + downloads */}
                                          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                            <button
                                              type="button"
                                              className="px-3 py-2 rounded-xl bg-white text-black font-black text-[10px] uppercase tracking-widest hover:bg-zinc-200 border border-white/10"
                                              onClick={async () => {
                                                if (!pageText.trim()) return;
                                                try {
                                                  // Use existing summarizeTranscript helper (already in App.tsx).
                                                  const summary = await summarizeTranscript(pageText);
                                                  // lightweight: reuse markdown area by injecting into ocrText preview
                                                  // (avoids adding new state in this patch).
                                                  alert(`Page ${p.page ?? ''} summary:\\n\\n${summary}`);
                                                } catch (e) {
                                                  console.error('Page summary failed:', e);
                                                  alert('Failed to generate page summary.');
                                                }
                                              }}
                                            >
                                              Summarize Page
                                            </button>

                                            <button
                                              type="button"
                                              className="px-3 py-2 rounded-xl bg-zinc-900/40 text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-900 border border-white/10"
                                              onClick={async () => {
                                                if (!pageText.trim()) return;
                                                try {
                                                  const summary = await summarizeTranscript(pageText);
                                                  const fileSafeName = String(file.fileName ?? 'unknown')
                                                    .replace(/[^a-z0-9\-_ ]/gi, '')
                                                    .replace(/\s+/g, '-')
                                                    .trim();

                                                  const md = `# Page Summary\n\n- File: ${file.fileName || 'Unknown'}\n- Page: ${p.page ?? ''}\n\n## Clinical Summary\n${summary}\n`;

                                                  downloadTextFile(
                                                    `page-summary-${fileSafeName}-p${p.page ?? ''}.md`,
                                                    md
                                                  );
                                                } catch (e) {
                                                  console.error('Download page summary failed:', e);
                                                  alert('Failed to generate page summary for download.');
                                                }
                                              }}
                                            >
                                              Download Page Summary
                                            </button>

                                            <div className="text-[10px] text-zinc-600 font-mono">
                                              Highlights indicate common clinical keywords found in OCR.
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                                {/* Folder-wide summary + downloads */}
                                <div className="border border-white/5 rounded-2xl p-4 bg-zinc-950/30">
                                  <div className="flex items-baseline justify-between gap-3 mb-2">
                                    <h4 className="text-sm font-bold text-white tracking-tight">Folder-wide Combined Summary</h4>
                                    <div className="text-[10px] text-zinc-600 font-mono">
                                      Total pages: {ocrResults.reduce((acc, f) => acc + (f.pages?.length ?? 0), 0)}
                                    </div>
                                  </div>
                                  <div className="text-[12px] text-zinc-500 font-mono mb-3">
                                    Generates a one-shot clinical overview for the whole uploaded folder.
                                  </div>

                                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    <button
                                      type="button"
                                      className="px-3 py-2 rounded-xl bg-white text-black font-black text-[10px] uppercase tracking-widest hover:bg-zinc-200 border border-white/10"
                                      onClick={async () => {
                                        const combined = ocrResults
                                          .flatMap((f) => (f.pages ?? []).map((p: any) => {
                                            const pageText = (p.lines ?? [])
                                              .map((l: any) => String(l?.text ?? '').trim())
                                              .filter(Boolean)
                                              .join(' ');
                                            return `File: ${f.fileName || 'Unknown'} | Page ${p.page ?? ''}\n${pageText}`;
                                          }))
                                          .join('\n\n');
                                        if (!combined.trim()) return;
                                        try {
                                          const summary = await summarizeTranscript(combined);
                                          alert(`Folder summary:\\n\\n${summary}`);
                                        } catch (e) {
                                          console.error('Folder summary failed:', e);
                                          alert('Failed to generate folder summary.');
                                        }
                                      }}
                                    >
                                      Summarize Folder
                                    </button>

                                    <button
                                      type="button"
                                      className="px-3 py-2 rounded-xl bg-zinc-900/40 text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-900 border border-white/10"
                                      onClick={async () => {
                                        try {
                                          const combined = ocrResults
                                            .flatMap((f) => (f.pages ?? []).map((p: any) => {
                                              const pageText = (p.lines ?? [])
                                                .map((l: any) => String(l?.text ?? '').trim())
                                                .filter(Boolean)
                                                .join(' ');
                                              return `File: ${f.fileName || 'Unknown'} | Page ${p.page ?? ''}\n${pageText}`;
                                            }))
                                            .join('\n\n')
                                            .trim();

                                          if (!combined) {
                                            alert('No OCR text available to summarize for download.');
                                            return;
                                          }

                                          const summary = await summarizeTranscript(combined);
                                          const md = `# Download - Folder Summary (Combined)\n\n## Clinical Summary\n${summary}\n`;
                                          downloadTextFile('download-folder-summary-combined.md', md);
                                        } catch (e) {
                                          console.error('Download folder summary failed:', e);
                                          alert('Failed to generate folder summary for download.');
                                        }
                                      }}
                                    >
                                      Download Folder Summary (combined)
                                    </button>

                                    <button
                                      type="button"
                                      className="px-3 py-2 rounded-xl bg-zinc-900/40 text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-900 border border-white/10"
                                      onClick={async () => {
                                        try {
                                          const pagesToSummarize = ocrResults
                                            .flatMap((f) =>
                                              (f.pages ?? []).map((p: any) => ({
                                                fileName: f.fileName,
                                                page: p.page,
                                                pageText: (p.lines ?? [])
                                                  .map((l: any) => String(l?.text ?? '').trim())
                                                  .filter(Boolean)
                                                  .join(' '),
                                              }))
                                            )
                                            .filter((x: any) => String(x.pageText ?? '').trim().length > 0);

                                          if (pagesToSummarize.length === 0) return;

                                          const mdParts: string[] = [];

                                          for (const item of pagesToSummarize) {
                                            try {
                                              const summary = await summarizeTranscript(item.pageText);
                                              mdParts.push(
                                                `## File: ${item.fileName || 'Unknown'} | Page: ${item.page ?? ''}\n\n### Clinical Summary\n${summary}\n`
                                              );
                                            } catch (pageErr) {
                                              console.error('Page summary failed:', item, pageErr);
                                              const fallbackSummary = readableOcrFallback(item.pageText);
                                              mdParts.push(
                                                `## File: ${item.fileName || 'Unknown'} | Page: ${item.page ?? ''}\n\n### Clinical Summary\n${fallbackSummary}\n`
                                              );
                                            }
                                          }

                                          const md = `# Download - All Page Summaries (all pages)\n\n${mdParts.join('\\n')}\n`;
                                          downloadTextFile('download-all-page-summaries-all-pages.md', md);
                                        } catch (e) {
                                          console.error('Download all page summaries failed:', e);
                                          alert('Failed to generate all page summaries for download.');
                                        }
                                      }}
                                    >
                                      Download All Page Summaries (all pages)
                                    </button>
                                  </div>

                                  <div className="text-[10px] text-zinc-600 font-mono mt-3">
                                    Note: summaries are generated via the existing AI helper. Downloads are generated as markdown files.
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-zinc-600 text-sm">No OCR pages available. Upload PDF/PNG/JPG/JPEG/TIFF to extract transcript.</div>
                            )}
                          </div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-30">
                            <FileSearch className="h-16 w-16 text-zinc-700" />
                            <div className="text-center">
                              <p className="text-xs font-black uppercase tracking-widest">Awaiting Pulse Signal</p>
                              <p className="text-[10px] font-bold mt-2">Neural output will manifest here</p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {isOCRProcessing && (
                        <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] flex items-center justify-center">
                           <div className="flex flex-col items-center gap-4">
                              <div className="h-12 w-12 rounded-full border-t-2 border-blue-500 animate-spin" />
                              <span className="text-[10px] font-black text-white uppercase tracking-[0.4em] animate-pulse">Scanning Bio-Patterns...</span>
                           </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'patients' && (
              <motion.div
                key="patients"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12 pb-20"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Patient Registry</h1>
                  <p className="text-sm text-zinc-500 font-medium">Centralized management of clinical identities and cohorts</p>
                </div>
                
                <div className="glass rounded-[3rem] border border-white/5 overflow-hidden">
                      <div className="p-6 border-b border-white/5 bg-zinc-900/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div className="flex flex-col gap-4 w-full md:w-auto">
                          <div className="flex gap-2">
                             {['All Patients', 'Active', 'Discharged', 'Critical'].map((tab, i) => (
                               <button 
                                 key={i} 
                                 onClick={() => setFilterStatus(tab)}
                                 className={cn(
                                 "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all",
                                 filterStatus === tab ? "bg-white text-black border-white" : "text-zinc-500 border-white/5 hover:bg-zinc-900"
                               )}>{tab}</button>
                             ))}
                          </div>
                          <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                            <input 
                              type="text" 
                              placeholder="Filter by name or MRN..." 
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full rounded-lg border border-white/5 bg-zinc-900/40 py-1.5 pl-10 pr-4 text-[10px] font-medium outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-600 uppercase tracking-tight"
                            />
                          </div>
                        </div>
                        <button 
                          onClick={() => setShowEnrollmentModal(true)}
                          className="flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-colors"
                        >
                           <Plus className="h-3.5 w-3.5" />
                           Enrollment
                        </button>
                      </div>
                   <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-900/40 border-b border-white/5">
                            <th className="px-8 py-5">
                               <button 
                                 onClick={() => setSortKey('name')}
                                 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2 hover:text-white transition-colors"
                               >
                                 Bio-Identity {sortKey === 'name' && <div className="h-1 w-1 rounded-full bg-blue-500" />}
                               </button>
                            </th>
                            <th className="px-8 py-5">
                               <button 
                                 onClick={() => setSortKey('mrn')}
                                 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2 hover:text-white transition-colors"
                               >
                                 Medical Record {sortKey === 'mrn' && <div className="h-1 w-1 rounded-full bg-blue-500" />}
                               </button>
                            </th>
                            <th className="px-8 py-5">
                               <button 
                                 onClick={() => setSortKey('date')}
                                 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2 hover:text-white transition-colors"
                               >
                                 Acquisition {sortKey === 'date' && <div className="h-1 w-1 rounded-full bg-blue-500" />}
                               </button>
                            </th>
                            <th className="px-8 py-5 text-[10px] font-black text-zinc-500 uppercase tracking-widest">Status</th>
                            <th className="px-8 py-5 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-right">Utility</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredPatients.length > 0 ? (
                            filteredPatients.map((p, i) => (
                              <tr 
                                key={i} 
                                onClick={() => {
                                  setSelectedPatient(p);
                                  setActiveTab('analysis');
                                }}
                                className="group cursor-pointer hover:bg-zinc-900/40 transition-all border-b border-white/[0.03]"
                              >
                                <td className="px-8 py-4">
                                  <div className="flex items-center gap-3">
                                     <div className="h-8 w-8 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center overflow-hidden">
                                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name}`} alt="" />
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-white/90 group-hover:text-blue-400 transition-colors">{p.name}</span>
                                        <span className="text-[10px] text-zinc-500 font-mono">{p.age} Y/O</span>
                                     </div>
                                  </div>
                                </td>
                                <td className="px-8 py-4">
                                  <span className="text-[11px] font-mono font-bold text-zinc-400">{p.mrn}</span>
                                </td>
                                <td className="px-8 py-4">
                                  <span className="text-[11px] font-medium text-zinc-500">{p.date || p.admission_date}</span>
                                </td>
                                <td className="px-8 py-4">
                                  <div className="flex items-center gap-2">
                                    <div className={cn("h-1.5 w-1.5 rounded-full", 
                                      p.color === 'blue' ? "bg-blue-500" :
                                      p.color === 'orange' ? "bg-orange-500" :
                                      p.color === 'green' ? "bg-green-500" : "bg-zinc-700"
                                    )} />
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight">{p.status}</span>
                                  </div>
                                </td>
                                <td className="px-8 py-4 text-right">
                                  <button className="p-1.5 rounded-md border border-white/5 text-zinc-600 hover:text-white transition-all">
                                     <MoreHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-8 py-20 text-center">
                                <div className="flex flex-col items-center gap-4">
                                  <div className="h-12 w-12 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center">
                                    <Search className="h-6 w-6 text-zinc-700" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-white font-bold">No Neural Matches Found</p>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-none">Try adjusting your search parameters</p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                   </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12 pb-20"
              >
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">Analytical Logic</h1>
                  <p className="text-sm text-zinc-500 font-medium">Configuration parameters for the mortality predictor engine</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                   <div className="md:col-span-1 space-y-6">
                      <nav className="space-y-2">
                        {['Neural Engine', 'Access Matrix', 'Audit Logging', 'Integration Hub', 'Security Pulse'].map((item, i) => (
                          <button key={i} className={cn(
                            "w-full text-left px-6 py-4 rounded-2xl text-sm font-bold transition-all",
                            i === 0 ? "bg-blue-600/10 text-white border border-blue-500/20 shadow-xl" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
                          )}>{item}</button>
                        ))}
                      </nav>
                   </div>
                   <div className="md:col-span-2 space-y-8">
                      <div className="glass rounded-[3rem] border border-white/5 p-12 space-y-10 relative overflow-hidden">
                         <div className="absolute top-0 right-0 p-8">
                            <Bot className="h-10 w-10 text-zinc-800" />
                         </div>
                         <div className="space-y-2">
                            <h2 className="text-3xl font-bold text-white tracking-tight">AI Reasoning Parameters</h2>
                            <p className="text-zinc-500">Global weighting for clinical predictive modeling</p>
                         </div>
                         <div className="space-y-8">
                            {[
                              { label: 'Risk Sensitivity Threshold', val: 0.85, desc: 'Determines alert frequency vs. precision' },
                              { label: 'Intervention Latency Buffer', val: 0.42, desc: 'Temporal window for preventative actions' },
                              { label: 'Bio-Signal Sampling Density', val: 0.95, desc: 'Vitals stream resolution mapping' }
                            ].map((param, i) => (
                              <div key={i} className="space-y-4">
                                 <div className="flex justify-between items-end">
                                    <div className="space-y-1">
                                       <span className="text-lg font-bold text-white tracking-tight">{param.label}</span>
                                       <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">{param.desc}</p>
                                    </div>
                                    <span className="text-2xl font-mono font-black text-blue-400">{param.val * 100}%</span>
                                 </div>
                                 <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden p-[1px]">
                                    <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${param.val * 100}%` }}
                                      className="h-full bg-blue-500 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
                                    />
                                 </div>
                              </div>
                            ))}
                         </div>
                         
                         <div className="pt-8 border-t border-white/5 flex justify-end gap-6">
                            <button className="px-8 py-3 rounded-xl border border-white/5 text-zinc-500 font-bold hover:text-white transition-colors">Reset Defaults</button>
                            <button className="px-10 py-3 rounded-xl bg-blue-500 text-white font-black uppercase tracking-widest text-xs hover:bg-blue-600 transition-colors shadow-2xl shadow-blue-500/20 italic">Update Vector Grid</button>
                         </div>
                      </div>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      {/* Enrollment Modal */}
      <AnimatePresence>
        {showEnrollmentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEnrollmentModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-xl glass rounded-[3rem] border border-white/10 p-10 space-y-8 overflow-hidden"
            >
               <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold text-white font-serif italic">Patient Enrollment</h2>
                    <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest font-mono">Initialization of Clinical Identity</p>
                  </div>
                  <button onClick={() => setShowEnrollmentModal(false)} className="h-10 w-10 rounded-full border border-white/5 flex items-center justify-center hover:bg-white/5 transition-colors">
                    <X className="h-5 w-5 text-white" />
                  </button>
               </div>
               <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
                  <div className="relative flex justify-center text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600"><span className="bg-black px-4">Manual Entry</span></div>
               </div>
               <form onSubmit={handleManualEnroll} className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-2">Patient Full Name</label>
                    <input name="name" required placeholder="John Doe" className="w-full rounded-xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-blue-500/30 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-2">Medical Record #</label>
                    <input name="mrn" required placeholder="MRN-2024-XXXX" className="w-full rounded-xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-blue-500/30 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-2">Age</label>
                    <input name="age" type="number" required placeholder="45" className="w-full rounded-xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-blue-500/30 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest px-2">Status</label>
                    <select name="status" className="w-full rounded-xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-blue-500/30 outline-none transition-all appearance-none">
                      <option>Active</option>
                      <option>Observation</option>
                      <option>Critical</option>
                      <option>Discharged</option>
                    </select>
                  </div>
                  <button type="submit" className="col-span-2 py-4 rounded-2xl bg-white text-black font-black uppercase tracking-[0.2em] text-[11px] hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)]">
                    Activate Enrollment
                  </button>
               </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* AI Assistant Floating Interface */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col items-end pointer-events-none">
        <AnimatePresence>
          {isAssistantOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="pointer-events-auto mb-4 w-96 glass rounded-[2.5rem] border border-white/10 flex flex-col h-[550px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 bg-zinc-950/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-xl bg-blue-600/20 flex items-center justify-center border border-blue-500/30">
                    <Bot className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white leading-none">Clinical Assistant</h3>
                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Matrix Active</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsAssistantOpen(false)}
                  className="h-8 w-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-zinc-950/20"
              >
                {chatMessages.map((msg, i) => (
                  <div 
                    key={i}
                    className={cn(
                      "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300",
                      msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                    )}
                  >
                    <div className={cn(
                      "p-4 rounded-3xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-blue-600/20 text-white rounded-tr-none border border-blue-500/20 shadow-[0_4px_12px_rgba(59,130,246,0.1)]" 
                        : "bg-zinc-900 text-zinc-300 rounded-tl-none border border-white/5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
                    )}>
                      <div className="markdown-body text-xs sm:text-sm">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                    <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-2 px-2">
                      {msg.role === 'assistant' ? 'AI Analytical Node' : 'Clinical User'}
                    </span>
                  </div>
                ))}
                {isAssistantTyping && (
                  <div className="mr-auto flex items-center gap-2 px-5 py-3 rounded-2xl bg-zinc-900 border border-white/5 shadow-lg">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce" />
                  </div>
                )}
              </div>
              <form
                onSubmit={handleSendMessage}
                className="p-6 border-t border-white/5 bg-zinc-950/60 backdrop-blur-xl"
              >
                <div className="relative">
                  <input
                    autoFocus
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder="Describe clinical symptoms or query analytics..."
                    className="w-full bg-zinc-950 border border-white/10 rounded-2xl py-4 pl-5 pr-24 text-sm text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all placeholder:text-zinc-600 shadow-inner"
                    type="text"
                    disabled={isAssistantTyping}
                  />
                  {/* Mic button (voice -> sets currentInput) */}
                  <button
                    type="button"
                    onClick={() => {
                      const SpeechRecognitionCtor =
                        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                      if (!SpeechRecognitionCtor) {
                        setChatMessages((prev) => [
                          ...prev,
                          {
                            role: 'assistant',
                            content:
                              'Voice input is not supported in this browser. Please type your message instead.',
                          },
                        ]);
                        return;
                      }
                      // stop current session if already listening
                      if (recognitionRef.current && isListening) {
                        try {
                          recognitionRef.current.stop();
                        } catch {
                          // ignore
                        }
                        return;
                      }
                      // Permission probe first (prevents recognition.start() from immediately throwing "not-allowed")
                      if (!navigator.mediaDevices?.getUserMedia) {
                        setChatMessages((prev) => [
                          ...prev,
                          {
                            role: 'assistant',
                            content:
                              'Voice input is not supported in this browser (missing getUserMedia). Please type your message instead.',
                          },
                        ]);
                        return;
                      }
                      navigator.mediaDevices
                        .getUserMedia({ audio: true })
                        .then((stream) => {
                          // Stop tracks immediately; SpeechRecognition will handle capturing audio.
                          stream.getTracks().forEach((t) => t.stop());
                          const recognition = new SpeechRecognitionCtor();
                          recognitionRef.current = recognition;
                          recognition.continuous = false;
                          recognition.interimResults = false;
                          recognition.lang = 'en-US';
                          recognition.onstart = () => {
                            setIsListening(true);
                          };
                          recognition.onerror = (event: any) => {
                            setIsListening(false);
                            const code = event?.error ? String(event.error) : 'unknown error';
                            const isNotAllowed = code === 'not-allowed' || code === 'service-not-allowed';
                            setChatMessages((prev) => [
                              ...prev,
                              {
                                role: 'assistant',
                                content: isNotAllowed
                                  ? 'Voice input failed: microphone permission denied ("not-allowed"). Please allow microphone access for this site, refresh, then try again.'
                                  : `Voice input error: ${code}`,
                              },
                            ]);
                          };
                          recognition.onresult = (event: any) => {
                            const text: string = (() => {
                              try {
                                const result = event?.results?.[0]?.[0];
                                return (result?.transcript ?? '') as string;
                              } catch {
                                return '';
                              }
                            })();
                            const normalized = String(text).trim();
                            if (normalized) {
                              setCurrentInput(normalized);
                            }
                          };
                          recognition.onend = () => {
                            setIsListening(false);
                          };
                          try {
                            recognition.start();
                          } catch {
                            setIsListening(false);
                          }
                        })
                        .catch((mediaErr: any) => {
                          setIsListening(false);
                          const code = String(mediaErr?.name || mediaErr?.message || 'not-allowed').toLowerCase();
                          setChatMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              content:
                                code.includes('notallowed') || code.includes('permission') || code.includes('denied')
                                  ? 'Voice input failed: microphone permission was denied. Please allow microphone access for this site (browser address-bar icon), refresh, then try again.'
                                  : `Voice input permission error: ${String(mediaErr?.message || mediaErr)}`,
                            },
                          ]);
                        });
                      // (speech recognition handlers are defined inside the getUserMedia().then(...) block)
                    }}
                    className="absolute right-11 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-white hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    aria-label="Voice input"
                    title="Voice input"
                    disabled={isAssistantTyping}
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                  {/* Send button (text -> existing handleSendMessage) */}
                  <button
                    type="submit"
                    disabled={!currentInput.trim() || isAssistantTyping}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white hover:bg-blue-500 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                    aria-label="Send message"
                    title="Send"
                  >
                    <ArrowUpRight className="h-5 w-5" />
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsAssistantOpen(!isAssistantOpen)}
          className={cn(
            "pointer-events-auto h-16 w-16 rounded-3xl flex items-center justify-center shadow-[0_20px_40px_rgba(0,0,0,0.4)] transition-all duration-500 group relative overflow-hidden active:scale-90",
            isAssistantOpen 
              ? "bg-zinc-950 border border-white/10 rotate-90" 
              : "bg-blue-600 hover:bg-blue-500"
          )}
        >
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          {isAssistantOpen ? (
            <X className="h-7 w-7 text-white" />
          ) : (
            <Bot className="h-7 w-7 text-white" />
          )}
          {!isAssistantOpen && (
            <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-600 border-2 border-zinc-950 rounded-full" />
          )}
        </motion.button>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
