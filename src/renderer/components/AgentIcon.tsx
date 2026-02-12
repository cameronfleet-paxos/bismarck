import { memo, useMemo } from 'react'
import type { AgentIconName } from '@/shared/constants'

// Import all icon SVGs
import einsteinSvg from '@/renderer/assets/icons/einstein.svg?raw'
import beethovenSvg from '@/renderer/assets/icons/beethoven.svg?raw'
import marxSvg from '@/renderer/assets/icons/marx.svg?raw'
import bismarckSvg from '@/renderer/assets/icons/bismarck.svg?raw'
import bachSvg from '@/renderer/assets/icons/bach.svg?raw'
import mozartSvg from '@/renderer/assets/icons/mozart.svg?raw'
import freudSvg from '@/renderer/assets/icons/freud.svg?raw'
import nietzscheSvg from '@/renderer/assets/icons/nietzsche.svg?raw'
import lutherSvg from '@/renderer/assets/icons/luther.svg?raw'
import goetheSvg from '@/renderer/assets/icons/goethe.svg?raw'
import beckenbauerSvg from '@/renderer/assets/icons/beckenbauer.svg?raw'
import kloppSvg from '@/renderer/assets/icons/klopp.svg?raw'
import mullerSvg from '@/renderer/assets/icons/muller.svg?raw'
import neuerSvg from '@/renderer/assets/icons/neuer.svg?raw'
import schweinsteigerSvg from '@/renderer/assets/icons/schweinsteiger.svg?raw'
import ballackSvg from '@/renderer/assets/icons/ballack.svg?raw'
import matthausSvg from '@/renderer/assets/icons/matthaus.svg?raw'
import rummeniggeSvg from '@/renderer/assets/icons/rummenigge.svg?raw'
import kraftwerkSvg from '@/renderer/assets/icons/kraftwerk.svg?raw'
import rammsteinSvg from '@/renderer/assets/icons/rammstein.svg?raw'
import scorpionsSvg from '@/renderer/assets/icons/scorpions.svg?raw'
import falcoSvg from '@/renderer/assets/icons/falco.svg?raw'
import nenaSvg from '@/renderer/assets/icons/nena.svg?raw'
import tokiohotelSvg from '@/renderer/assets/icons/tokiohotel.svg?raw'
import fassbenderSvg from '@/renderer/assets/icons/fassbender.svg?raw'
import schweigerSvg from '@/renderer/assets/icons/schweiger.svg?raw'
import krugerSvg from '@/renderer/assets/icons/kruger.svg?raw'
import bruhlSvg from '@/renderer/assets/icons/bruhl.svg?raw'
import waltzSvg from '@/renderer/assets/icons/waltz.svg?raw'
import hannaSvg from '@/renderer/assets/icons/hanna.svg?raw'
import klumSvg from '@/renderer/assets/icons/klum.svg?raw'
import schifferSvg from '@/renderer/assets/icons/schiffer.svg?raw'
import bruniSvg from '@/renderer/assets/icons/bruni.svg?raw'
import bundchenSvg from '@/renderer/assets/icons/bundchen.svg?raw'
import schumacherSvg from '@/renderer/assets/icons/schumacher.svg?raw'
import vettelSvg from '@/renderer/assets/icons/vettel.svg?raw'
import rosbergSvg from '@/renderer/assets/icons/rosberg.svg?raw'
import merkelSvg from '@/renderer/assets/icons/merkel.svg?raw'
import kinskiSvg from '@/renderer/assets/icons/kinski.svg?raw'
import herzogSvg from '@/renderer/assets/icons/herzog.svg?raw'
import wendersSvg from '@/renderer/assets/icons/wenders.svg?raw'
import beuysSvg from '@/renderer/assets/icons/beuys.svg?raw'
import lagerfeldSvg from '@/renderer/assets/icons/lagerfeld.svg?raw'
import flickSvg from '@/renderer/assets/icons/flick.svg?raw'
import hasselhoffSvg from '@/renderer/assets/icons/hasselhoff.svg?raw'
import dirkSvg from '@/renderer/assets/icons/dirk.svg?raw'
import beckerSvg from '@/renderer/assets/icons/becker.svg?raw'
import grafSvg from '@/renderer/assets/icons/graf.svg?raw'

const iconMap: Record<AgentIconName, string> = {
  einstein: einsteinSvg,
  beethoven: beethovenSvg,
  marx: marxSvg,
  bismarck: bismarckSvg,
  bach: bachSvg,
  mozart: mozartSvg,
  freud: freudSvg,
  nietzsche: nietzscheSvg,
  luther: lutherSvg,
  goethe: goetheSvg,
  beckenbauer: beckenbauerSvg,
  klopp: kloppSvg,
  muller: mullerSvg,
  neuer: neuerSvg,
  schweinsteiger: schweinsteigerSvg,
  ballack: ballackSvg,
  matthaus: matthausSvg,
  rummenigge: rummeniggeSvg,
  kraftwerk: kraftwerkSvg,
  rammstein: rammsteinSvg,
  scorpions: scorpionsSvg,
  falco: falcoSvg,
  nena: nenaSvg,
  tokiohotel: tokiohotelSvg,
  fassbender: fassbenderSvg,
  schweiger: schweigerSvg,
  kruger: krugerSvg,
  bruhl: bruhlSvg,
  waltz: waltzSvg,
  hanna: hannaSvg,
  klum: klumSvg,
  schiffer: schifferSvg,
  bruni: bruniSvg,
  bundchen: bundchenSvg,
  schumacher: schumacherSvg,
  vettel: vettelSvg,
  rosberg: rosbergSvg,
  merkel: merkelSvg,
  kinski: kinskiSvg,
  herzog: herzogSvg,
  wenders: wendersSvg,
  beuys: beuysSvg,
  lagerfeld: lagerfeldSvg,
  flick: flickSvg,
  hasselhoff: hasselhoffSvg,
  dirk: dirkSvg,
  becker: beckerSvg,
  graf: grafSvg,
}

interface AgentIconProps {
  icon: AgentIconName
  className?: string
}

export const AgentIcon = memo(function AgentIcon({ icon, className = 'w-4 h-4' }: AgentIconProps) {
  const svg = iconMap[icon]
  const innerHTML = useMemo(() => svg ? { __html: svg } : null, [svg])

  if (!innerHTML) {
    // Fallback: show a generic silhouette
    return (
      <div className={`${className} bg-white/20 rounded-full`} />
    )
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex' }}
      dangerouslySetInnerHTML={innerHTML}
    />
  )
})
