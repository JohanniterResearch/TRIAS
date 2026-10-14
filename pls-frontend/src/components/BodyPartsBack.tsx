import type React from 'react';

interface BodyPartsBackProps {
  id: string;
  /** Omitted: read-only, not focusable. */
  onClick?: (id: string, isClicked: boolean) => void;
  initialClickedState: boolean | number;
}

const BodyPartsBack = ({ id, onClick, initialClickedState }: BodyPartsBackProps) => {
  const isClicked = !!initialClickedState;

  const handleClick = () => {
    onClick?.(id, !isClicked);
  };

  const fill = isClicked ? 'red' : '#808080';
  const style = { fill, stroke: 'black', strokeWidth: 1 };

  const getBodyPart = () => {
    switch (id) {
      case 'kopf_hinten':
        return <ellipse style={style} id="kopf_hinten" cx="51.188187" cy="20.800844" rx="21.162607" ry="18.630329" />;
      case 'hals_hinten':
        return <rect style={style} id="hals_hinten" width="14.108405" height="11.214372" x="43.410477" y="38.345917" />;
      case 'ruecken_links':
        return <rect style={style} id="ruecken_links" width="11.937881" height="43.410473" x="30.387331" y="49.560295" />;
      case 'ruecken_rechts':
        return <rect style={style} id="ruecken_rechts" width="11.937881" height="43.410473" x="58.242386" y="49.560295" />;
      case 'becken_links_hinten':
        return <rect style={style} id="becken_links_hinten" width="11.763668" height="18.636993" x="29.93181" y="93.238747" />;
      case 'becken_rechts_hinten':
        return <rect style={style} id="becken_rechts_hinten" width="12.113685" height="18.625257" x="58.154491" y="93.244614" />;
      case 'genital_hinten':
        return <path style={style} id="genital_hinten" d="m 34.092779,113.31881 h 30 l -15.235231,12.96018 z" />;
      case 'oberschenkel_links_hinten':
        return <rect style={style} id="oberschenkel_links_hinten" width="7.5968332" height="37.260658" x="44.81213" y="104.36919" transform="rotate(11.084325)" />;
      case 'oberschenkel_rechts_hinten':
        return <rect style={style} id="oberschenkel_rechts_hinten" width="7.5968332" height="37.260658" x="46.380962" y="122.03924" transform="rotate(-10.379456)" />;
      case 'unterschenkel_links_hinten':
        return <rect style={style} id="unterschenkel_links_hinten" width="7.5968332" height="31.472595" x="15.193666" y="155.19244" />;
      case 'unterschenkel_rechts_hinten':
        return <rect style={style} id="unterschenkel_rechts_hinten" width="7.5968332" height="31.472595" x="73.797806" y="154.83069" />;
      case 'oberarm_links_hinten':
        return <rect style={style} id="oberarm_links_hinten" width="5.3013601" height="29.510719" x="42.386909" y="30.966864" transform="matrix(0.85927699,0.51151056,-0.44289859,0.89657171,0,0)" />;
      case 'oberarm_rechts_hinten':
        return <rect style={style} id="oberarm_rechts_hinten" width="5.608892" height="25.70512" x="30.162931" y="84.677483" transform="matrix(0.84710696,-0.53142243,0.57047303,0.82131633,0,0)" />;
      case 'unterarm_links_hinten':
        return <rect style={style} id="unterarm_links_hinten" width="5.7880635" height="31.472595" x="7.235074" y="81.39463" />;
      case 'unterarm_rechts_hinten':
        return <rect style={style} id="unterarm_rechts_hinten" width="5.7880635" height="31.472595" x="90.80024" y="78.138855" />;
      case 'schulter_links_hinten':
        return <ellipse style={style} id="schulter_links_hinten" cx="26.95067" cy="49.017662" rx="6.3306942" ry="5.6071858" />;
      case 'schulter_rechts_hinten':
        return <ellipse style={style} id="schulter_rechts_hinten" cx="72.893417" cy="50.102921" rx="6.3306942" ry="5.6071858" />;
      case 'huefte_links_hinten':
        return <ellipse style={style} id="huefte_links_hinten" cx="28.035913" cy="113.40987" rx="6.3306942" ry="5.6071858" />;
      case 'huefte_rechts_hinten':
        return <ellipse style={style} id="huefte_rechts_hinten" cx="69.999382" cy="113.77161" rx="6.3306942" ry="5.6071858" />;
      case 'knie_links_hinten':
        return <ellipse style={style} id="knie_links_hinten" cx="18.992075" cy="151.03227" rx="6.3306942" ry="5.6071858" />;
      case 'knie_rechts_hinten':
        return <ellipse style={style} id="knie_rechts_hinten" cx="77.234451" cy="150.67052" rx="6.3306942" ry="5.6071858" />;
      case 'ellbogen_links_hinten':
        return <ellipse style={style} id="ellbogen_links_hinten" cx="10.852616" cy="79.766754" rx="5.0645556" ry="4.521924" />;
      case 'ellbogen_rechts_hinten':
        return <ellipse style={style} id="ellbogen_rechts_hinten" cx="92.970772" cy="75.425705" rx="5.7880635" ry="4.883678" />;
      case 'fuss_links_hinten':
        return <ellipse style={style} id="fuss_links_hinten" cx="17.002436" cy="191.72961" rx="7.9585872" ry="6.5115709" />;
      case 'fuss_rechts_hinten':
        return <ellipse style={style} id="fuss_rechts_hinten" cx="78.86235" cy="191.0061" rx="7.9585872" ry="6.5115709" />;
      case 'hand_links_hinten':
        return <ellipse style={style} id="hand_links_hinten" cx="9.767354" cy="116.48479" rx="7.9585872" ry="6.5115709" />;
      case 'hand_rechts_hinten':
        return <ellipse style={style} id="hand_rechts_hinten" cx="92.970757" cy="112.50549" rx="7.9585872" ry="6.5115709" />;
      case 'brustwirbel':
        return <ellipse style={style} id="brustwirbel" cx="50.392338" cy="70.472542" rx="6.5475974" ry="20.232826" />;
      case 'lendenwirbel':
        return <ellipse style={style} id="lendenwirbel" cx="50.00864" cy="101.80787" rx="7.0820742" ry="9.7679596" />;
      default:
        return null;
    }
  };

  return (
    // WP 7.4: each region is a checkbox for keyboard and screen-reader users (Tab, Enter, Space).
    <g
      className="body-region"
      onClick={handleClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
      {...(onClick && {
        role: 'checkbox',
        tabIndex: 0,
        'aria-checked': isClicked,
        'aria-label': id.replace(/_/g, ' '),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handleClick();
        },
      })}
    >
      {getBodyPart()}
    </g>
  );
};

export default BodyPartsBack;
