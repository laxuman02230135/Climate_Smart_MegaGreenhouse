const BACKGROUND_VIDEO_URL =
  'https://res.cloudinary.com/dncwqfssd/video/upload/v1793262880/1029_1.mp4';

export function AuthVideoBackground() {
  return (
    <>
      <video
        className="proto-auth-video"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src={BACKGROUND_VIDEO_URL} type="video/mp4" />
      </video>
      <div className="proto-auth-video-overlay" aria-hidden="true" />
    </>
  );
}
