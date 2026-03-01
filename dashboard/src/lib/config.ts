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

export const services: ServiceConfig[] = [
  {
    id: 'wazuh',
    name: 'Wazuh',
    role: 'SIEM / XDR',
    badge: 'SIEM',
    color: 'var(--accent)',
    icon: 'Shield',
    dashboardUrl: 'https://localhost:5601',
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
    dashboardUrl: 'http://localhost:3000',
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
    dashboardUrl: 'http://localhost:4000',
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
    dashboardUrl: 'http://localhost:9000',
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
    dashboardUrl: 'http://localhost:9001',
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
