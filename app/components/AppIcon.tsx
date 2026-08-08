import {
  ArrowLeft, ArrowRight, BookmarkSimple, Books, CaretRight, CheckCircle,
  DownloadSimple, GearSix, House, MagnifyingGlass, Plus, Sparkle,
  UploadSimple, X, type Icon, type IconProps,
} from "@phosphor-icons/react";

const icons = {
  add: Plus, back: ArrowLeft, bookmark: BookmarkSimple, close: X,
  completion: CheckCircle, download: DownloadSimple, forward: ArrowRight,
  home: House, library: Books, next: CaretRight, review: Sparkle,
  search: MagnifyingGlass, settings: GearSix, upload: UploadSimple,
} satisfies Record<string, Icon>;

export type AppIconName = keyof typeof icons;

type AppIconProps = Omit<IconProps, "weight"> & { name: AppIconName };

export function AppIcon({ name, ...props }: AppIconProps) {
  const IconComponent = icons[name];
  return <IconComponent aria-hidden="true" focusable="false" weight="regular" {...props} />;
}
