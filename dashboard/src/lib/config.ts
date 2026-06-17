import { env } from '$env/dynamic/public';
import { Shield, ChartColumn, Radar, ShieldAlert, Brain } from 'lucide-svelte';

export interface ServiceConfig {
  id: string;
  name: string;
  role: string;
  badge: string;
  color: string;
  icon: string;
  dashboardUrl: string;
  embeddable: boolean;
  port: number;
}

/**
 * Single source of truth for the icon lookup, shared by ServiceCard + Sidebar + the
 * service detail layout so the map is declared once (was duplicated identically across
 * components). Typed as `typeof Shield` to match lucide-svelte's component type.
 */
export const iconMap: Record<string, typeof Shield> = {
  Shield,
  ChartColumn,
  Radar,
  ShieldAlert,
  Brain
};

/** Shared placeholders so the "not loaded yet" representation is consistent everywhere. */
export const LOADING_PLACEHOLDER = '...';
export const CHECKING_STATUS = 'checking';

/**
 * Public, client-exposed base URLs. These are read in the BROWSER (iframe srcs +
 * "open in new tab" links) so they must be reachable from wherever the operator
 * browses — set PUBLIC_*_URL when serving off-localhost. Defaults keep local dev working.
 */
export const publicUrls = {
  wazuhDashboard: env.PUBLIC_WAZUH_DASHBOARD_URL || 'https://localhost:5601',
  grafana: env.PUBLIC_GRAFANA_URL || 'http://localhost:3000',
  opencti: env.PUBLIC_OPENCTI_URL || 'http://localhost:4000',
  thehive: env.PUBLIC_THEHIVE_URL || 'http://localhost:9000',
  cortex: env.PUBLIC_CORTEX_URL || 'http://localhost:9001'
};

export const services: ServiceConfig[] = [
  {
    id: 'wazuh',
    name: 'Wazuh',
    role: 'SIEM / XDR',
    badge: 'SIEM',
    color: 'var(--accent)',
    icon: 'Shield',
    // Derived from PUBLIC_* env so a host/port change happens in one place (was hardcoded).
    dashboardUrl: publicUrls.wazuhDashboard,
    embeddable: false,
    port: 5601
  },
  {
    id: 'grafana',
    name: 'Grafana',
    role: 'Monitoring',
    badge: 'MONITOR',
    color: 'var(--accent)',
    icon: 'ChartColumn',
    dashboardUrl: publicUrls.grafana,
    embeddable: true,
    port: 3000
  },
  {
    id: 'opencti',
    name: 'OpenCTI',
    role: 'Threat Intelligence',
    badge: 'THREAT INTEL',
    color: 'var(--accent)',
    icon: 'Radar',
    dashboardUrl: publicUrls.opencti,
    embeddable: false,
    port: 4000
  },
  {
    id: 'thehive',
    name: 'TheHive',
    role: 'Incident Response',
    badge: 'IR',
    color: 'var(--accent)',
    icon: 'ShieldAlert',
    dashboardUrl: publicUrls.thehive,
    embeddable: true,
    port: 9000
  },
  {
    id: 'cortex',
    name: 'Cortex',
    role: 'Analysis & Response',
    badge: 'SOAR',
    color: 'var(--accent)',
    icon: 'Brain',
    dashboardUrl: publicUrls.cortex,
    embeddable: false,
    port: 9001
  }
];

export const grafanaDashboards = [
  { label: 'Wazuh SOC', path: '/d/wazuh-soc-overview/wazuh-soc-overview?orgId=1&kiosk' },
  { label: 'K8s Cluster', path: '/d/efa86fd1d0c121a26444b636a3f509a8/kubernetes-compute-resources-cluster?orgId=1&kiosk' },
  { label: 'Node Exporter', path: '/d/7d57716318ee0dddbac5a7f451fb7753/node-exporter-nodes?orgId=1&kiosk' },
  { label: 'CoreDNS', path: '/d/vkQ0UHxik/coredns?orgId=1&kiosk' }
];
