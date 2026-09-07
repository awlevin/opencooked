import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop } from './components/Backdrop.tsx';
import { FONT } from './font.ts';
import { outlined, PAL } from './theme.ts';

const FPS = 30;
const SEC = (n: number) => n * FPS;
const slides = [
  { image: 'review/mobile-entry.png', eyebrow: '01 · five-second pitch', title: 'twitter traffic lands somewhere useful.', body: 'the phone now explains the setup, shows the value, and gives each role a clear door.', phone: true },
  { image: 'review/host-lobby.png', eyebrow: '02 · party setup', title: 'the big screen teaches the room.', body: 'scan, name your chef, start. the host now reads as a three-step ritual from across the couch.', phone: false },
  { image: 'review/quick-start.png', eyebrow: '03 · first successful dish', title: 'new chefs get the recipe before the timer.', body: 'one short, skippable card teaches both thumbs and the onion soup loop.', phone: true },
  { image: 'review/mobile-lobby.png', eyebrow: '04 · confidence before chaos', title: 'connection and identity are unmistakable.', body: 'chef color, shared-screen cue, kitchen preview, and a much clearer start action.', phone: true },
  { image: 'review/gamepad.png', eyebrow: '05 · thumb-first controls', title: 'the gamepad says what every press does.', body: 'stronger move affordance, explicit hold language, safer pause, and released inputs on reconnect.', phone: true },
];

const Frame: React.FC<{ src: string; phone: boolean }> = ({ src, phone }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 15, stiffness: 110 } });
  return <div style={{ position: 'relative', width: phone ? 380 : 920, height: phone ? 760 : 575, transform: `translateY(${interpolate(pop,[0,1],[45,0])}px) rotate(${phone ? -1.5 : .7}deg) scale(${interpolate(pop,[0,1],[.9,1])})`, opacity: pop, border: `8px solid ${PAL.ink}`, borderRadius: phone ? 58 : 28, overflow: 'hidden', background: '#080a10', boxShadow: '0 26px 0 rgba(28,16,9,.62), 0 50px 90px rgba(0,0,0,.45)' }}>
    <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: phone ? 'cover' : 'contain', background: '#1c110a' }} />
  </div>;
};

const Slide: React.FC<{ slide: typeof slides[number] }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const copy = spring({ frame: frame - 7, fps: FPS, config: { damping: 17 } });
  return <AbsoluteFill style={{ fontFamily: FONT, color: PAL.cream }}>
    <Backdrop />
    <div style={{ position:'absolute', inset:0, display:'grid', gridTemplateColumns: slide.phone ? '1fr 520px' : '650px 1fr', alignItems:'center', gap:90, padding:'70px 110px' }}>
      {slide.phone ? <div style={{ opacity: copy, transform:`translateX(${interpolate(copy,[0,1],[-35,0])}px)` }}><Copy slide={slide}/></div> : <Frame src={slide.image} phone={slide.phone}/> }
      {slide.phone ? <Frame src={slide.image} phone={slide.phone}/> : <div style={{ opacity: copy, transform:`translateX(${interpolate(copy,[0,1],[35,0])}px)` }}><Copy slide={slide}/></div>}
    </div>
  </AbsoluteFill>;
};

const Copy: React.FC<{ slide: typeof slides[number] }> = ({ slide }) => <div>
  <div style={{ color: PAL.butter, fontSize:26, fontWeight:800, letterSpacing:'.16em', textTransform:'uppercase' }}>{slide.eyebrow}</div>
  <h2 style={{ margin:'24px 0', fontSize:72, lineHeight:.95, letterSpacing:'-.03em', ...outlined(.065) }}>{slide.title}</h2>
  <p style={{ margin:0, maxWidth:620, color:PAL.cream2, fontSize:34, lineHeight:1.25, fontWeight:600 }}>{slide.body}</p>
</div>;

const Intro: React.FC = () => {
  const f=useCurrentFrame(); const pop=spring({frame:f,fps:FPS,config:{damping:12}});
  return <AbsoluteFill style={{fontFamily:FONT,color:PAL.cream,display:'grid',placeItems:'center'}}><Backdrop/><div style={{position:'relative',textAlign:'center',transform:`scale(${interpolate(pop,[0,1],[.75,1])})`,opacity:pop}}><div style={{fontSize:28,letterSpacing:'.28em',color:PAL.cream2}}>MOBILE-FIRST OVERHAUL</div><h1 style={{margin:'18px 0 8px',fontSize:174,lineHeight:.86,...outlined(.08)}}>OPEN<span style={{color:PAL.butter}}>COOKED</span></h1><div style={{display:'inline-block',padding:'8px 28px 12px',fontSize:50,fontWeight:800,letterSpacing:'.14em',color:PAL.ink,background:PAL.butter,border:`7px solid ${PAL.ink}`,borderRadius:999,transform:'rotate(-2deg)'}}>DOUGLAS + ASTRA</div><p style={{fontSize:34,color:PAL.cream2}}>a faster pitch, a gentler first shift, a better controller.</p></div></AbsoluteFill>;
};

const Outro: React.FC = () => <AbsoluteFill style={{fontFamily:FONT,color:PAL.cream,display:'grid',placeItems:'center'}}><Backdrop/><div style={{position:'relative',textAlign:'center'}}><div style={{fontSize:30,letterSpacing:'.22em',color:PAL.butter}}>READY FOR REVIEW</div><h2 style={{margin:'18px 0',fontSize:100,lineHeight:.95,...outlined(.07)}}>phones out.<br/>aprons on.</h2><p style={{fontSize:34,color:PAL.cream2}}>real game paths preserved · 90 tests · build · websocket smoke · iphone flow</p></div></AbsoluteFill>;

export const REVIEW_FRAMES = SEC(3) + slides.length * SEC(4) + SEC(3);
export const ReviewWalkthrough: React.FC = () => <AbsoluteFill style={{background:PAL.night}}><Sequence durationInFrames={SEC(3)}><Intro/></Sequence>{slides.map((slide,i)=><Sequence key={slide.image} from={SEC(3+i*4)} durationInFrames={SEC(4)}><Slide slide={slide}/></Sequence>)}<Sequence from={SEC(3+slides.length*4)} durationInFrames={SEC(3)}><Outro/></Sequence></AbsoluteFill>;
