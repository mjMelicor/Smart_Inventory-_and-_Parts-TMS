import Sidebar from './Sidebar';import Topbar from './Topbar';
export default function Layout({role,page,setPage,onLogout,children}){return <div className="appShell"><Sidebar role={role} page={page} setPage={setPage}/><div className="main"><Topbar role={role} onLogout={onLogout}/><main className="content">{children}</main></div></div>}
