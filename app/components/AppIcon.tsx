import {
  ArrowLeft, ArrowRight, BookmarkSimple, Books, CaretRight, CheckCircle,
  Clock, DownloadSimple, GearSix, House, MagnifyingGlass, Microphone, Play, Plus, Repeat, SpeakerHigh, Sparkle, Stop,
  UploadSimple, X, type Icon, type IconProps,
} from "@phosphor-icons/react";

const icons = {
  add: Plus, back: ArrowLeft, bookmark: BookmarkSimple, close: X,
  completion: CheckCircle, download: DownloadSimple, forward: ArrowRight,
  home: House, library: Books, next: CaretRight, review: Sparkle,
  search: MagnifyingGlass, settings: GearSix, upload: UploadSimple,
  microphone: Microphone, speaker: SpeakerHigh, play: Play, stop: Stop, repeat: Repeat, clock: Clock,
} satisfies Record<string, Icon>;

export type AppIconName = keyof typeof icons;

type AppIconProps = Omit<IconProps, "weight"> & { name: AppIconName };

export function AppIcon({ name, ...props }: AppIconProps) {
  const IconComponent = icons[name];
  return <IconComponent aria-hidden="true" focusable="false" weight="regular" {...props} />;
}
