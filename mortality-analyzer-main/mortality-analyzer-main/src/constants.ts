import { 
  LayoutDashboard, 
  UploadCloud, 
  FileSearch, 
  Clock, 
  ShieldAlert,
  Users
} from 'lucide-react';


export const NAVIGATION_ITEMS = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'ocr', label: 'Clinical OCR', icon: FileSearch },
  { id: 'analysis', label: 'Mortality Analysis', icon: FileSearch },
  { id: 'timeline', label: 'Clinical Progression', icon: Clock },
  { id: 'risk', label: 'Risk Modeling', icon: ShieldAlert },
  { id: 'patients', label: 'Patient Registry', icon: Users },
  // Configuration removed from sidebar navigation
];


export const SYSTEM_STATS = [
  { label: 'Records Processed', value: '248', change: '+12%', trend: 'up', color: 'green' },
  { label: 'Active Alerts', value: '7', change: '-3', trend: 'down', color: 'red' },
  { label: 'Avg. Preventability', value: '82%', change: '+5%', trend: 'up', color: 'blue' },
  { label: 'System Uptime', value: '99.9%', change: 'Stable', trend: 'neutral', color: 'zinc' },
];

export const RECENT_ACTIVITY = [
  { id: '1', title: 'New record uploaded', subtitle: 'Sarah Johnson - MRN-2024-7832', time: '2 mins ago', status: 'PROCESSING', statusColor: 'orange' },
  { id: '2', title: 'Risk alert generated', subtitle: 'Michael Chen - MRN-2024-7801', time: '15 mins ago', status: 'ALERT', statusColor: 'red' },
  { id: '3', title: 'Analysis completed', subtitle: 'Emily Rodriguez - MRN-2024-7789', time: '1 hour ago', status: 'COMPLETED', statusColor: 'green' },
  { id: '4', title: 'Voice input transcribed', subtitle: 'David Kim - MRN-2024-7765', time: '2 hours ago', status: 'COMPLETED', statusColor: 'green' },
];

export const PATIENT_DATA = {
  name: 'Sarah Johnson',
  age: '62 years',
  mrn: 'MRN-2024-7832',
  admissionDate: 'April 20, 2026',
  findings: [
    { label: 'Chief Complaint', value: 'Chest pain radiating to left arm', confidence: '95%' },
    { label: 'Diagnosis', value: 'Acute Coronary Syndrome (ACS)', confidence: '92%' },
    { label: 'Comorbidities', value: 'Type 2 Diabetes, Hypertension', confidence: '88%' }
  ]
};

export const DATA_STREAMS = [
  { id: 'stream-1', label: 'Biometric Feed', active: true, load: '12%' },
  { id: 'stream-2', label: 'AI Processor 04', active: true, load: '48%' },
  { id: 'stream-3', label: 'HL7 Integrator', active: false, load: '0%' },
];
