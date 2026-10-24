// Tabler outline icons, the same set the public site uses. Each one is imported as raw SVG text at build time, so
// the bundle only carries the icons listed here (not the thousands in the package) and nothing is fetched at run time.
import alertTriangle from '@tabler/icons/outline/alert-triangle.svg?raw';
import arrowDown from '@tabler/icons/outline/arrow-down.svg?raw';
import arrowLeft from '@tabler/icons/outline/arrow-left.svg?raw';
import arrowRight from '@tabler/icons/outline/arrow-right.svg?raw';
import arrowUp from '@tabler/icons/outline/arrow-up.svg?raw';
import bold from '@tabler/icons/outline/bold.svg?raw';
import heading from '@tabler/icons/outline/heading.svg?raw';
import italic from '@tabler/icons/outline/italic.svg?raw';
import link from '@tabler/icons/outline/link.svg?raw';
import list from '@tabler/icons/outline/list.svg?raw';
import quote from '@tabler/icons/outline/quote.svg?raw';
import brandLinkedin from '@tabler/icons/outline/brand-linkedin.svg?raw';
import buildingStore from '@tabler/icons/outline/building-store.svg?raw';
import calendarEvent from '@tabler/icons/outline/calendar-event.svg?raw';
import calendarPlus from '@tabler/icons/outline/calendar-plus.svg?raw';
import check from '@tabler/icons/outline/check.svg?raw';
import chevronDown from '@tabler/icons/outline/chevron-down.svg?raw';
import circleCheck from '@tabler/icons/outline/circle-check.svg?raw';
import clock from '@tabler/icons/outline/clock.svg?raw';
import cloudUpload from '@tabler/icons/outline/cloud-upload.svg?raw';
import externalLink from '@tabler/icons/outline/external-link.svg?raw';
import infoCircle from '@tabler/icons/outline/info-circle.svg?raw';
import layoutDashboard from '@tabler/icons/outline/layout-dashboard.svg?raw';
import logout from '@tabler/icons/outline/logout.svg?raw';
import mapPin from '@tabler/icons/outline/map-pin.svg?raw';
import menu from '@tabler/icons/outline/menu-2.svg?raw';
import microphone from '@tabler/icons/outline/microphone.svg?raw';
import moon from '@tabler/icons/outline/moon.svg?raw';
import news from '@tabler/icons/outline/news.svg?raw';
import photo from '@tabler/icons/outline/photo.svg?raw';
import photoPlus from '@tabler/icons/outline/photo-plus.svg?raw';
import photoStar from '@tabler/icons/outline/photo-star.svg?raw';
import plus from '@tabler/icons/outline/plus.svg?raw';
import rocket from '@tabler/icons/outline/rocket.svg?raw';
import search from '@tabler/icons/outline/search.svg?raw';
import sun from '@tabler/icons/outline/sun.svg?raw';
import trash from '@tabler/icons/outline/trash.svg?raw';
import userPlus from '@tabler/icons/outline/user-plus.svg?raw';
import users from '@tabler/icons/outline/users.svg?raw';
import writing from '@tabler/icons/outline/writing.svg?raw';
import x from '@tabler/icons/outline/x.svg?raw';

const ICONS = {
  'alert-triangle': alertTriangle,
  'arrow-down': arrowDown,
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  'arrow-up': arrowUp,
  bold,
  heading,
  italic,
  link,
  list,
  quote,
  'brand-linkedin': brandLinkedin,
  'building-store': buildingStore,
  'calendar-event': calendarEvent,
  'calendar-plus': calendarPlus,
  check,
  'chevron-down': chevronDown,
  'circle-check': circleCheck,
  clock,
  'cloud-upload': cloudUpload,
  'external-link': externalLink,
  'info-circle': infoCircle,
  'layout-dashboard': layoutDashboard,
  logout,
  'map-pin': mapPin,
  menu,
  microphone,
  moon,
  news,
  photo,
  'photo-plus': photoPlus,
  'photo-star': photoStar,
  plus,
  rocket,
  search,
  sun,
  trash,
  'user-plus': userPlus,
  users,
  writing,
  x,
} as const;

export type IconName = keyof typeof ICONS;

/** Decorative: the label next to it says what it means, so it is hidden from screen readers. */
export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  // The SVG text comes from our own installed package at build time, never from user input.
  const svg = ICONS[name]
    .replace('width="24"', `width="${size}"`)
    .replace('height="24"', `height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true" focusable="false"');
  return <span aria-hidden="true" className={`inline-flex shrink-0 ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
