import './chemistry-loader.css';

export default function ChemistryLoader({large=false}:{large?:boolean}) {
 return <svg className={`chemistry-loader ${large?'large':''}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path className="flask-fluid" d="M18 39h28l7 12a4 4 0 0 1-4 6H15a4 4 0 0 1-4-6Z"/>
  <path className="flask-outline" d="M24 6h16M27 7v19L11 51a4 4 0 0 0 4 6h34a4 4 0 0 0 4-6L37 26V7"/>
  <g className="molecule"><path d="m21 45 11 5 10-8"/><circle cx="21" cy="45" r="3"/><circle cx="32" cy="50" r="3"/><circle cx="42" cy="42" r="3"/></g>
  <circle className="flask-bubble one" cx="29" cy="35" r="2"/><circle className="flask-bubble two" cx="35" cy="31" r="2"/>
 </svg>;
}
