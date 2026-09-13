// draw.io에서 실제 참조된 도형만 byte-exact subset으로 가져온다. 이 파일만 네트워크를 쓴다.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'vendor/drawio-stencils');
const repo = 'jgraph/drawio';
const licensePath = 'src/main/webapp/stencils/LICENSE';
const PINNED_COMMIT = '48b181339578e11da7052ebf5b1fba8499418b77';

export const SHAPES = [
  'Switch', 'Router', 'Firewall', 'Load Balancer', 'Server', 'Storage', 'Rack', 'Cloud', 'Mobile', 'PC', 'Server Storage',
  'Proxy Server', 'Web Server', 'Virtual Server', 'NAS Filer', 'Hub', 'Mainframe',
  'Secured', 'Comm Link', 'Security Camera', 'Wireless Hub', 'Modem',
  'Mail Server', 'External Storage', 'Tape Storage', 'Users',
];

export const REFERENCE_STENCILS = [
  { drawioId: 'mxgraph.aws3.ec2', path: 'src/main/webapp/stencils/aws3.xml', name: 'EC2' },
  { drawioId: 'mxgraph.aws3.network_access_controllist', path: 'src/main/webapp/stencils/aws3.xml', name: 'Network Access Controllist' },
  { drawioId: 'mxgraph.aws3.elastic_load_balancing', path: 'src/main/webapp/stencils/aws3.xml', name: 'Elastic Load Balancing' },
  { drawioId: 'mxgraph.aws3.vpc_nat_gateway', path: 'src/main/webapp/stencils/aws3.xml', name: 'VPC NAT Gateway' },
  { drawioId: 'mxgraph.aws3.application_load_balancer', path: 'src/main/webapp/stencils/aws3.xml', name: 'Application Load Balancer' },
  { drawioId: 'mxgraph.aws3.internet_gateway', path: 'src/main/webapp/stencils/aws3.xml', name: 'Internet Gateway' },
  { drawioId: 'mxgraph.aws3.rds_db_instance', path: 'src/main/webapp/stencils/aws3.xml', name: 'RDS DB Instance' },
  { drawioId: 'mxgraph.aws3.vpn_connection', path: 'src/main/webapp/stencils/aws3.xml', name: 'VPN Connection' },
  { drawioId: 'mxgraph.aws3.kms', path: 'src/main/webapp/stencils/aws3.xml', name: 'KMS' },
  { drawioId: 'mxgraph.azure.access_control', path: 'src/main/webapp/stencils/azure.xml', name: 'Access Control' },
  { drawioId: 'mxgraph.office.users.mobile_user', path: 'src/main/webapp/stencils/office/users.xml', name: 'Mobile User' },
  { drawioId: 'mxgraph.office.users.user_services', path: 'src/main/webapp/stencils/office/users.xml', name: 'User Services' },
  { drawioId: 'mxgraph.ios7.icons.data', path: 'src/main/webapp/stencils/ios7/icons.xml', name: 'Data' },
  { drawioId: 'mxgraph.ios7.icons.user', path: 'src/main/webapp/stencils/ios7/icons.xml', name: 'User' },
  { drawioId: 'mxgraph.citrix.firewall', path: 'src/main/webapp/stencils/citrix.xml', name: 'Firewall' },
  { drawioId: 'mxgraph.flowchart.database', path: 'src/main/webapp/stencils/flowchart.xml', name: 'Database' },
  { drawioId: 'mxgraph.flowchart.on-page_reference', path: 'src/main/webapp/stencils/flowchart.xml', name: 'On-page Reference' },
  { drawioId: 'mxgraph.office.servers.server_generic', path: 'src/main/webapp/stencils/office/servers.xml', name: 'Server Generic' },
  { drawioId: 'mxgraph.office.servers.web_server', path: 'src/main/webapp/stencils/office/servers.xml', name: 'Web Server' },
  { drawioId: 'mxgraph.aws4.network_firewall_endpoints', path: 'src/main/webapp/stencils/aws4.xml', name: 'network firewall endpoints' },
  { drawioId: 'mxgraph.aws4.instance2', path: 'src/main/webapp/stencils/aws4.xml', name: 'instance2' },
  { drawioId: 'mxgraph.aws4.application_load_balancer', path: 'src/main/webapp/stencils/aws4.xml', name: 'application load balancer' },
  { drawioId: 'mxgraph.aws4.nat_gateway', path: 'src/main/webapp/stencils/aws4.xml', name: 'nat gateway' },
  { drawioId: 'mxgraph.aws4.illustration_users', path: 'src/main/webapp/stencils/aws4.xml', name: 'illustration users' },
  { drawioId: 'mxgraph.aws4.internet_gateway', path: 'src/main/webapp/stencils/aws4.xml', name: 'internet gateway' },
  { drawioId: 'mxgraph.aws4.ecs_task', path: 'src/main/webapp/stencils/aws4.xml', name: 'ecs task' },
  { drawioId: 'mxgraph.aws4.network_load_balancer', path: 'src/main/webapp/stencils/aws4.xml', name: 'network load balancer' },
  { drawioId: 'mxgraph.aws4.ecs_service', path: 'src/main/webapp/stencils/aws4.xml', name: 'ecs service' },
  { drawioId: 'mxgraph.aws4.peering', path: 'src/main/webapp/stencils/aws4.xml', name: 'peering' },
  { drawioId: 'mxgraph.aws4.vpn_gateway', path: 'src/main/webapp/stencils/aws4.xml', name: 'vpn gateway' },
  { drawioId: 'mxgraph.aws4.group_subnet', path: 'src/main/webapp/stencils/aws4.xml', name: 'group subnet' },
  { drawioId: 'mxgraph.aws4.aws_cloud', path: 'src/main/webapp/stencils/aws4.xml', name: 'aws cloud' },
  { drawioId: 'mxgraph.aws4.elastic_load_balancing', path: 'src/main/webapp/stencils/aws4.xml', name: 'elastic load balancing' },
  { drawioId: 'mxgraph.aws4.security_group', path: 'src/main/webapp/stencils/aws4.xml', name: 'security group' },
  { drawioId: 'mxgraph.aws4.vpc', path: 'src/main/webapp/stencils/aws4.xml', name: 'vpc' },
  { drawioId: 'mxgraph.cisco19.lock', path: 'src/main/webapp/stencils/cisco19.xml', name: 'lock' },
  { drawioId: 'mxgraph.aws4.ec2_image_builder', path: 'src/main/webapp/stencils/aws4.xml', name: 'ec2 image builder' },
  { drawioId: 'mxgraph.aws3.route_53', path: 'src/main/webapp/stencils/aws3.xml', name: 'Route 53' },
  { drawioId: 'mxgraph.aws3.cloudfront', path: 'src/main/webapp/stencils/aws3.xml', name: 'CloudFront' },
  { drawioId: 'mxgraph.aws3.s3', path: 'src/main/webapp/stencils/aws3.xml', name: 'S3' },
  { drawioId: 'mxgraph.aws3.virtual_private_cloud', path: 'src/main/webapp/stencils/aws3.xml', name: 'Virtual Private Cloud' },
  { drawioId: 'mxgraph.aws3.redis', path: 'src/main/webapp/stencils/aws3.xml', name: 'Redis' },
  { drawioId: 'mxgraph.aws3.mysql_db_instance_2', path: 'src/main/webapp/stencils/aws3.xml', name: 'MySQL DB Instance 2' },
  { drawioId: 'mxgraph.aws3.codedeploy', path: 'src/main/webapp/stencils/aws3.xml', name: 'CodeDeploy' },
  { drawioId: 'mxgraph.aws3.ecr_registry', path: 'src/main/webapp/stencils/aws3.xml', name: 'ECR Registry' },
  { drawioId: 'mxgraph.aws3.athena', path: 'src/main/webapp/stencils/aws3.xml', name: 'Athena' },
  { drawioId: 'mxgraph.aws3.auto_scaling', path: 'src/main/webapp/stencils/aws3.xml', name: 'Auto Scaling' },
  { drawioId: 'mxgraph.aws3.direct_connect', path: 'src/main/webapp/stencils/aws3.xml', name: 'Direct Connect' },
  { drawioId: 'mxgraph.aws3.corporate_data_center', path: 'src/main/webapp/stencils/aws3.xml', name: 'Corporate Data Center' },
  { drawioId: 'mxgraph.mscae.system_center.admin_console', path: 'src/main/webapp/stencils/mscae/system_center.xml', name: 'Admin Console' },
  { drawioId: 'mxgraph.aws4.users', path: 'src/main/webapp/stencils/aws4.xml', name: 'users' },
  { drawioId: 'mxgraph.flowchart.terminator', path: 'src/main/webapp/stencils/flowchart.xml', name: 'Terminator' },
  // Kubernetes icons are a wrapper: the frame draws the tile and prIcon names
  // the glyph inside it. Only the observed glyphs are vendored.
  { drawioId: 'mxgraph.kubernetes.frame', path: 'src/main/webapp/stencils/kubernetes.xml', name: 'frame' },
  { drawioId: 'mxgraph.kubernetes.node', path: 'src/main/webapp/stencils/kubernetes.xml', name: 'node' },
  { drawioId: 'mxgraph.kubernetes.pod', path: 'src/main/webapp/stencils/kubernetes.xml', name: 'pod' },
  { drawioId: 'mxgraph.cisco_safe.capability.web_application_firewall', path: 'src/main/webapp/stencils/cisco_safe/capability.xml', name: 'web application firewall' },
  { drawioId: 'mxgraph.aws4.api_gateway', path: 'src/main/webapp/stencils/aws4.xml', name: 'api gateway' },
  { drawioId: 'mxgraph.aws4.key_management_service', path: 'src/main/webapp/stencils/aws4.xml', name: 'key management service' },
  { drawioId: 'mxgraph.aws4.managed_blockchain', path: 'src/main/webapp/stencils/aws4.xml', name: 'managed blockchain' },
  { drawioId: 'mxgraph.aws4.systems_manager', path: 'src/main/webapp/stencils/aws4.xml', name: 'systems manager' },
  // Target AWS4 closure. Keep this list limited to the observed resource, group,
  // illustration, and direct-stencil dependencies rather than vendoring AWS4.
  { drawioId: 'mxgraph.aws4.ec2', path: 'src/main/webapp/stencils/aws4.xml', name: 'ec2' },
  { drawioId: 'mxgraph.aws4.elastic_ip_address', path: 'src/main/webapp/stencils/aws4.xml', name: 'elastic ip address' },
  { drawioId: 'mxgraph.aws4.private_certificate_authority', path: 'src/main/webapp/stencils/aws4.xml', name: 'private certificate authority' },
  { drawioId: 'mxgraph.aws4.secrets_manager', path: 'src/main/webapp/stencils/aws4.xml', name: 'secrets manager' },
  { drawioId: 'mxgraph.aws4.cloudwatch_2', path: 'src/main/webapp/stencils/aws4.xml', name: 'cloudwatch 2' },
  { drawioId: 'mxgraph.aws4.eventbridge', path: 'src/main/webapp/stencils/aws4.xml', name: 'eventbridge' },
  { drawioId: 'mxgraph.aws4.workspaces', path: 'src/main/webapp/stencils/aws4.xml', name: 'workspaces' },
  { drawioId: 'mxgraph.aws4.s3', path: 'src/main/webapp/stencils/aws4.xml', name: 's3' },
  { drawioId: 'mxgraph.aws4.sns', path: 'src/main/webapp/stencils/aws4.xml', name: 'sns' },
  { drawioId: 'mxgraph.aws4.ecs_anywhere', path: 'src/main/webapp/stencils/aws4.xml', name: 'ecs anywhere' },
  { drawioId: 'mxgraph.aws4.vpn_connection', path: 'src/main/webapp/stencils/aws4.xml', name: 'vpn connection' },
  { drawioId: 'mxgraph.aws4.generic_firewall', path: 'src/main/webapp/stencils/aws4.xml', name: 'generic firewall' },
  { drawioId: 'mxgraph.aws4.lambda_function', path: 'src/main/webapp/stencils/aws4.xml', name: 'lambda function' },
  { drawioId: 'mxgraph.aws4.illustration_office_building', path: 'src/main/webapp/stencils/aws4.xml', name: 'illustration office building' },
  { drawioId: 'mxgraph.aws4.illustration_notification', path: 'src/main/webapp/stencils/aws4.xml', name: 'illustration notification' },
  { drawioId: 'mxgraph.aws4.group_aws_cloud_alt', path: 'src/main/webapp/stencils/aws4.xml', name: 'group aws cloud alt' },
  { drawioId: 'mxgraph.aws4.group_region', path: 'src/main/webapp/stencils/aws4.xml', name: 'group region' },
  { drawioId: 'mxgraph.aws4.group_vpc2', path: 'src/main/webapp/stencils/aws4.xml', name: 'group vpc2' },
  { drawioId: 'mxgraph.aws4.group_security_group', path: 'src/main/webapp/stencils/aws4.xml', name: 'group security group' },
  { drawioId: 'mxgraph.aws4.group_ec2_instance_contents', path: 'src/main/webapp/stencils/aws4.xml', name: 'group ec2 instance contents' },
  { drawioId: 'mxgraph.aws4.group_corporate_data_center', path: 'src/main/webapp/stencils/aws4.xml', name: 'group corporate data center' },
  { drawioId: 'mxgraph.aws4.group_on_premise', path: 'src/main/webapp/stencils/aws4.xml', name: 'group on premise' },
  { drawioId: 'mxgraph.cisco19.bg1', path: 'src/main/webapp/stencils/cisco19.xml', name: 'bg1' },
  { drawioId: 'mxgraph.cisco19.l2_switch', path: 'src/main/webapp/stencils/cisco19.xml', name: 'l2 switch' },
  { drawioId: 'mxgraph.cisco19.l3_switch', path: 'src/main/webapp/stencils/cisco19.xml', name: 'l3 switch' },
  { drawioId: 'mxgraph.cisco19.ips_ids', path: 'src/main/webapp/stencils/cisco19.xml', name: 'ips ids' },
];

export const EXACT_PORTS = [
  { drawioId: 'mxgraph.ios.iPhone', path: 'src/main/webapp/shapes/mockup/mxMockupiOS.js', symbol: 'mxShapeMockupiPhone.paintVertexShape', renderer: 'mockup-iphone', dependencies: [], styleFields: ['fillColor', 'bgStyle'], exactScope: 'the black body, the bezel highlight, the screen for the flat background styles, and the camera, speaker and home button chrome. bgMap and bgStriped draw their flat screen instead of the illustration upstream fills it with.' },
  { drawioId: 'umlActor', path: 'src/main/webapp/js/grapheditor/Shapes.js', symbol: 'UmlActorShape.paintBackground', renderer: 'uml-actor', dependencies: [], styleFields: ['fillColor', 'strokeColor', 'strokeWidth'], exactScope: 'head ellipse at (w/4, 0, w/2, h/4) filled and stroked, then the body, arms and legs stroked at the same fractions upstream uses.' },
  { drawioId: 'note', path: 'src/main/webapp/js/grapheditor/Shapes.js', symbol: 'NoteShape.paintVertexShape', renderer: 'note', dependencies: [], styleFields: ['fillColor', 'strokeColor', 'strokeWidth', 'size'], exactScope: 'the folded-corner outline with size clamped to 0..min(w, h). The darkOpacity wedge is not drawn because the observed styles leave it at 0.' },
  { drawioId: 'mxgraph.kubernetes.icon', path: 'src/main/webapp/shapes/mxKubernetes.js', symbol: 'mxShapeKubernetesIcon.paintVertexShape', renderer: 'kubernetes-icon', dependencies: ['mxgraph.kubernetes.frame', 'mxgraph.kubernetes.node', 'mxgraph.kubernetes.pod'], styleFields: ['fillColor', 'strokeColor', 'prIcon', 'aspect'], exactScope: 'frame in strokeColor, the same frame inset to 94% in fillColor, then the observed prIcon glyph at a 20% inset in strokeColor. An unobserved prIcon draws the tile without a glyph.' },
  { drawioId: 'mxgraph.aws4.resourceicon', path: 'src/main/webapp/shapes/mxAWS4.js', symbol: 'mxShapeAws4ResourceIcon.paintVertexShape', renderer: 'aws4-resource-icon', dependencies: ['mxgraph.aws4.api_gateway', 'mxgraph.aws4.key_management_service', 'mxgraph.aws4.managed_blockchain', 'mxgraph.aws4.systems_manager'], styleFields: ['fillColor', 'strokeColor', 'resIcon', 'aspect'], exactScope: 'fill-only background plus a 10% inset glyph. Unknown resource icons intentionally have no glyph.' },
  { drawioId: 'mxgraph.cisco19.rect', path: 'src/main/webapp/shapes/mxCisco19.js', symbol: 'mxShapeCisco19Rect.paintVertexShape', renderer: 'cisco19-rect', dependencies: ['mxgraph.cisco19.bg1', 'mxgraph.cisco19.l2_switch', 'mxgraph.cisco19.l3_switch', 'mxgraph.cisco19.ips_ids'], styleFields: ['fillColor', 'strokeColor', 'prIcon', 'aspect'], exactScope: 'observed prIcon values only. Draw bg1, then the observed glyph with fillColor=strokeColor.' },
  { drawioId: 'mxgraph.arrows2.stripedarrow', path: 'src/main/webapp/shapes/mxArrows.js', symbol: 'mxShapeArrows2StripedArrow.paintVertexShape', renderer: 'arrows2-striped-arrow', dependencies: [], styleFields: ['fillColor', 'strokeColor', 'strokeWidth', 'dx', 'dy', 'notch'], exactScope: 'same path commands and clamp rules as upstream paintVertexShape.' },
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
async function fetchText(url, accept = 'text/plain') {
  const response = await fetch(url, { headers: { accept, 'user-agent': 'rack-mesh-vendor-stencils' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

// 업스트림 바이트를 재직렬화하지 않고 잘라 낸다.
export function extractShapes(xml, names) {
  const blocks = xml.match(/<shape\b[^>]*>[\s\S]*?<\/shape>/g) || [];
  const found = new Map();
  for (const block of blocks) {
    const name = block.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    if (found.has(name)) throw new Error(`도형 이름이 중복됩니다: ${name}`);
    found.set(name, block);
  }
  const missing = names.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`업스트림에 없는 도형: ${missing.join(', ')}`);
  return names.map((name) => found.get(name));
}

async function main() {
  const commit = process.argv[2] || PINNED_COMMIT;
  if (commit !== PINNED_COMMIT) throw new Error(`pinned commit만 허용합니다: ${PINNED_COMMIT}`);
  const raw = `https://raw.githubusercontent.com/${repo}/${commit}`;
  const paths = [...new Set(['src/main/webapp/stencils/networks.xml', ...REFERENCE_STENCILS.map(({ path }) => path), ...EXACT_PORTS.map(({ path }) => path)])];
  const responses = await Promise.all([...paths.map(async (path) => [path, await fetchText(`${raw}/${path}`)]), fetchText(`${raw}/${licensePath}`)]);
  const license = responses.pop();
  const sources = new Map(responses);
  const networkXml = sources.get('src/main/webapp/stencils/networks.xml');
  const networkSubset = `<shapes name="mxgraph.networks">\n${extractShapes(networkXml, SHAPES).join('\n')}\n</shapes>\n`;
  const referenceBlocks = REFERENCE_STENCILS.map((item) => ({ ...item, block: extractShapes(sources.get(item.path), [item.name])[0] }));
  const referenceSubset = `<shapes name="rack-mesh.references">\n${referenceBlocks.map(({ block }) => block).join('\n')}\n</shapes>\n`;
  const sourceRecords = Object.fromEntries(paths.map((path) => [path, { bytes: Buffer.byteLength(sources.get(path), 'utf8'), sha256: sha256(sources.get(path)) }]));

  await mkdir(vendorDir, { recursive: true });
  await writeFile(resolve(vendorDir, 'networks.subset.xml'), networkSubset);
  await writeFile(resolve(vendorDir, 'references.subset.xml'), referenceSubset);
  await writeFile(resolve(vendorDir, 'LICENSE.txt'), license);
  await writeFile(resolve(vendorDir, 'PROVENANCE.json'), `${JSON.stringify({
    upstream: `https://github.com/${repo}`, commit, fetchedAt: new Date().toISOString().slice(0, 10), license: 'Apache-2.0 + stencils/LICENSE restriction',
    sources: sourceRecords,
    subsets: {
      networks: { path: 'src/main/webapp/stencils/networks.xml', sha256: sha256(networkSubset), shapes: SHAPES },
      references: { sha256: sha256(referenceSubset), stencils: referenceBlocks.map(({ drawioId, path, name }) => ({ drawioId, path, name })) },
      exactPorts: EXACT_PORTS,
    },
  }, null, 2)}\n`);
  console.log(`networks.subset.xml  ${Buffer.byteLength(networkSubset, 'utf8')} bytes · ${SHAPES.length} shapes`);
  console.log(`references.subset.xml ${Buffer.byteLength(referenceSubset, 'utf8')} bytes · ${referenceBlocks.length} stencils`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
