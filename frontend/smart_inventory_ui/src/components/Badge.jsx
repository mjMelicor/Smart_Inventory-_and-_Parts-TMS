export default function Badge({children,type}){const cls=(type||String(children)).toLowerCase().replaceAll(' ','-');return <span className={`badge ${cls}`}>{children}</span>}
