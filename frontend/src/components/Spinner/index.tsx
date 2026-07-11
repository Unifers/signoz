import { CSSProperties } from 'react';
import { Loader } from '@signozhq/icons';
import { Spin, SpinProps } from 'antd';

import { SpinerStyle } from './styles';

function Spinner({ size, tip, height, style }: SpinnerProps): JSX.Element {
	return (
		<SpinerStyle height={height} style={style}>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: '8px',
				}}
			>
				<Spin
					spinning
					size={size}
					indicator={
						<Loader
							className="animate-spin"
							role="img"
							aria-label="loading"
							size="md"
						/>
					}
				/>
				{tip && <div className="ant-spin-text">{tip}</div>}
			</div>
		</SpinerStyle>
	);
}

interface SpinnerProps {
	size?: SpinProps['size'];
	tip?: SpinProps['tip'];
	height?: CSSProperties['height'];
	style?: CSSProperties;
}
Spinner.defaultProps = {
	size: undefined,
	tip: undefined,
	height: undefined,
	style: {},
};

export default Spinner;
