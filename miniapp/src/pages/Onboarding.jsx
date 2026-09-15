import { useState } from 'react';
import { useApp } from '../store.jsx';
import { haptic } from '../telegram.js';

const SLIDES = [
  { emoji: '🍽', key: 'slide1' },
  { emoji: '📲', key: 'slide2' },
  { emoji: '🎉', key: 'slide3' },
];

export default function Onboarding({ onFinish }) {
  const { t } = useApp();
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  const next = () => {
    haptic('light');
    if (isLast) onFinish();
    else setStep((value) => value + 1);
  };

  return (
    <div className="onboarding">
      <button className="onboarding-skip" onClick={onFinish}>
        {t('onboarding.skip')}
      </button>
      <div className="onboarding-slide">
        <div className="onboarding-emoji">{slide.emoji}</div>
        <h1>{t(`onboarding.${slide.key}Title`)}</h1>
        <p>{t(`onboarding.${slide.key}Text`)}</p>
      </div>
      <div className="onboarding-dots">
        {SLIDES.map((item, index) => (
          <span key={item.key} className={index === step ? 'active' : ''} />
        ))}
      </div>
      <button className="btn btn-primary" onClick={next}>
        {isLast ? t('onboarding.start') : t('onboarding.next')}
      </button>
    </div>
  );
}
