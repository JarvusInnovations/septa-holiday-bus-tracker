import './ComingSoon.css';

export default function ComingSoon() {
  return (
    <div className="coming-soon">
      <div className="coming-soon-card" role="status">
        <div className="coming-soon-emoji" aria-hidden="true">🎄🚌🎁</div>
        <h1>Coming Soon!</h1>
        <p>
          This year's Festibuses haven't hit the streets yet. Check back soon
          to track SEPTA's decorated holiday buses and trolleys live!
        </p>
      </div>
    </div>
  );
}
