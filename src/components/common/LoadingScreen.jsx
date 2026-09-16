export default function LoadingScreen({ text = 'در حال بارگذاری...' }) {
  return (
    <div className="loading-screen">
      <p>{text}</p>
    </div>
  )
}
